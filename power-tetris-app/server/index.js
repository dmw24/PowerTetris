const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const highs = require('highs');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from the built frontend in production
const distPath = path.join(__dirname, '../dist');
if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
}

const PORT = process.env.PORT || 3001;
const HOURS_IN_WEEK = 168;

// loaded dynamically
let WEEK_CONFIGS = {
    es: [],
    gb: [],
    fr: []
};

// Multi-country support
const DATASETS = {
    es: { solar: [], wind: [], offshore: [], extreme: [] },
    gb: { solar: [], wind: [], offshore: [], extreme: [] },
    fr: { solar: [], wind: [], offshore: [], extreme: [] }
};

let highsSolver = null;

async function loadData() {
    // In production (after build), data is in dist/data. In development, it's in public/data.
    const distDataDir = path.join(__dirname, '../dist/data');
    const publicDataDir = path.join(__dirname, '../public/data');
    const dataDir = fs.existsSync(distDataDir) ? distDataDir : publicDataDir;
    const codes = ['es', 'gb', 'fr'];

    for (const code of codes) {
        console.log(`Loading data for ${code}...`);
        try {
            const solarRaw = fs.readFileSync(path.join(dataDir, `${code}_solar_2019.csv`), 'utf-8');
            const windRaw = fs.readFileSync(path.join(dataDir, `${code}_wind_2019.csv`), 'utf-8');
            const extremeRaw = fs.readFileSync(path.join(dataDir, `${code}_extreme_week.json`), 'utf-8');

            let offshoreData = [];
            try {
                const offshoreRaw = fs.readFileSync(path.join(dataDir, `${code}_offshore_2019.csv`), 'utf-8');
                offshoreData = parse(offshoreRaw, { columns: true, cast: true });
            } catch (e) {
                // Ignore if missing
            }

            DATASETS[code].solar = parse(solarRaw, { columns: true, cast: true });
            DATASETS[code].wind = parse(windRaw, { columns: true, cast: true });
            DATASETS[code].offshore = offshoreData;
            DATASETS[code].extreme = JSON.parse(extremeRaw);
        } catch (e) {
            console.error(`Failed to load data for ${code}:`, e.message);
        }
    }

    try {
        const weeksRaw = fs.readFileSync(path.join(dataDir, 'representative_weeks.json'), 'utf-8');
        WEEK_CONFIGS = JSON.parse(weeksRaw);
        console.log('Loaded representative weeks config');
    } catch (e) {
        console.error('Failed to load representative_weeks.json:', e);
    }

    highsSolver = await highs();
    console.log('HiGHS solver initialized');
}

function generateDemand(hour, time, demandProfile = 'spain') {
    const baseDemand = 30000;

    if (demandProfile === 'baseload') {
        return baseDemand;
    }

    // Spain-like profile with daily and seasonal variation (UTC+1 approximation)
    const date = new Date(time);
    const hourOfDay = (date.getUTCHours() + 1) % 24;
    const month = date.getUTCMonth();

    let seasonFactor = 1.0;
    if (month < 2 || month > 10) seasonFactor = 1.1;
    if (month > 5 && month < 8) seasonFactor = 1.15;

    let dailyFactor = 0.8;
    if (hourOfDay >= 7 && hourOfDay < 23) dailyFactor = 1.0;
    if (hourOfDay >= 20 && hourOfDay < 22) dailyFactor = 1.1;
    if (hourOfDay >= 13 && hourOfDay < 16) dailyFactor = 1.05;

    return Math.round(baseDemand * seasonFactor * dailyFactor);
}

function getWeekData(weekConf, demandProfile = 'spain', region = 'es') {
    const { startHour, weight, isExtreme, includeInStats } = weekConf;

    const dataset = DATASETS[region] || DATASETS['es'];

    if (isExtreme) {
        return dataset.extreme.map(h => ({
            ...h,
            demand: generateDemand(h.hour, h.time, demandProfile),
            weight: weight,
            includeInStats: includeInStats,
            offshore: h.offshore || 0
        }));
    }

    const chunk = [];
    if (!dataset.solar.length) return [];

    for (let i = startHour; i < startHour + HOURS_IN_WEEK && i < dataset.solar.length; i++) {
        chunk.push({
            hour: i,
            time: dataset.solar[i].time,
            demand: generateDemand(i, dataset.solar[i].time, demandProfile),
            solar: dataset.solar[i].factor || 0,
            wind: dataset.wind[i]?.factor || 0,
            offshore: dataset.offshore[i]?.factor || 0,
            weight: weight,
            includeInStats: includeInStats
        });
    }
    return chunk;
}

function getAnnualFixedCost(tech) {
    const r = tech.wacc / 100;
    const n = tech.lifetime;

    let annualizedCapex = 0;
    if (n > 0) {
        if (r === 0) {
            annualizedCapex = tech.capex / n;
        } else {
            const crf = (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
            annualizedCapex = tech.capex * crf;
        }
    }
    return annualizedCapex + tech.opexFixed;
}

function getMarginalCost(tech) {
    return tech.opexVar + tech.fuelCost;
}

function buildLPModel(techs, dataChunks, minRenewables = 0) {
    const enabledTechs = Object.values(techs).filter(t => t.enabled);

    // minRenewables is 0-100. If > 0, we apply a constraint:
    // Sum(Non-Renewable-Gen) <= TotalDemand * (1 - min/100)
    // Non-Renewables: Nuclear, Coal, Gas, Diesel, Hydrogen (assuming gray/blue for now, or just non-inverter renewables?)
    // Actually, "Renewables" usually means Solar + Wind.
    // So Non-Renewables = All Dispatchable (Thermal).

    const VOLL = 20000000; // 20M to force capacity build
    const BATTERY_EFF = 0.9;
    const BATTERY_C_RATE = 1; // 1C = can fully charge/discharge in 1 hour

    // Flatten data but keep structure
    const flatData = dataChunks.flat();
    const TOTAL_HOURS = flatData.length;

    let objective = [];
    let constraints = [];
    let bounds = [];
    const vars = new Set();

    // Find battery tech for special handling
    const battTech = enabledTechs.find(t => t.type === 'storage');

    // Capacity costs (Annualized)
    enabledTechs.forEach(tech => {
        if (tech.type === 'storage') {
            // Battery: cost is $/kWh (energy capacity)
            // Use capexPerKwh if available, otherwise derive from capex/duration
            const costPerKwh = tech.capexPerKwh || (tech.capex / (tech.duration || 4));
            const r = tech.wacc / 100;
            const n = tech.lifetime;
            let annualizedCapexPerKwh = 0;
            if (n > 0) {
                if (r === 0) {
                    annualizedCapexPerKwh = costPerKwh / n;
                } else {
                    const crf = (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
                    annualizedCapexPerKwh = costPerKwh * crf;
                }
            }
            // Add fixed O&M (assume per kWh of energy capacity)
            const annualCostPerMwh = (annualizedCapexPerKwh + (tech.opexFixed || 0) / (tech.duration || 4)) * 1000; // $/MWh/yr
            objective.push(`+ ${annualCostPerMwh} e_${tech.id}`);
            vars.add(`e_${tech.id}`); // Energy capacity variable (MWh)

            if (tech.isFixed) {
                // Fixed in GW -> Model uses MWh. Assuming 1C rate (MW = MWh).
                constraints.push(`fix_e_${tech.id}: e_${tech.id} = ${(tech.fixedCapacity || 0) * 1000}`);
            }
        } else {
            // Non-storage: cost is $/kW (power capacity)
            const cost = getAnnualFixedCost(tech) * 1000; // $/MW/yr
            objective.push(`+ ${cost} c_${tech.id}`);
            vars.add(`c_${tech.id}`);

            if (tech.isFixed) {
                // Fixed in GW -> Model uses MW
                constraints.push(`fix_c_${tech.id}: c_${tech.id} = ${(tech.fixedCapacity || 0) * 1000}`);
            }
        }
    });

    for (let i = 0; i < TOTAL_HOURS; i++) {
        const hourData = flatData[i];
        const weight = hourData.weight || 0;

        let balanceLHS = [];

        enabledTechs.forEach(tech => {
            if (tech.type === 'storage') return;

            const varGen = `g_${tech.id}_${i}`;
            vars.add(varGen);

            // Variable cost scaled by weight
            const marginalCost = getMarginalCost(tech);
            if (marginalCost > 0) {
                objective.push(`+ ${marginalCost * weight} ${varGen}`);
            }

            balanceLHS.push(`+ ${varGen}`);

            if (tech.type === 'renewable') {
                let profile = 0;
                if (tech.id === 'SOLAR') profile = hourData.solar;
                if (tech.id === 'WIND') profile = hourData.wind;
                if (tech.id === 'WIND_OFFSHORE') profile = hourData.offshore;

                if (profile > 0.001) {
                    constraints.push(`cap_${tech.id}_${i}: ${varGen} - ${profile} c_${tech.id} <= 0`);
                } else {
                    constraints.push(`cap_${tech.id}_${i}: ${varGen} <= 0`);
                }
            } else {
                constraints.push(`cap_${tech.id}_${i}: ${varGen} - c_${tech.id} <= 0`);
            }
        });

        if (battTech) {
            const vCh = `b_ch_${i}`;
            const vDis = `b_dis_${i}`;
            const vSoc = `b_soc_${i}`;
            vars.add(vCh);
            vars.add(vDis);
            vars.add(vSoc);

            // Cost of cycling/usage scaled by weight
            objective.push(`+ ${0.1 * weight} ${vCh}`);

            balanceLHS.push(`+ ${vDis}`);
            balanceLHS.push(`- ${vCh}`);

            // Power limited by C-rate: charge/discharge <= energy_capacity * C_rate
            // With 1C rate, max power (MW) = energy capacity (MWh)
            constraints.push(`ch_lim_${i}: ${vCh} - ${BATTERY_C_RATE} e_${battTech.id} <= 0`);
            constraints.push(`dis_lim_${i}: ${vDis} - ${BATTERY_C_RATE} e_${battTech.id} <= 0`);

            // SoC limited directly by energy capacity
            constraints.push(`soc_cap_${i}: ${vSoc} - e_${battTech.id} <= 0`);

            // SoC dynamics
            if (i % HOURS_IN_WEEK !== 0) {
                const prevSoc = `b_soc_${i - 1}`;
                constraints.push(`soc_dyn_${i}: ${vSoc} - ${prevSoc} - ${BATTERY_EFF} ${vCh} + ${vDis} = 0`);
            } else if (i > 0) {
                // First hour of new week - start fresh
                constraints.push(`soc_start_${i}: ${vSoc} - ${BATTERY_EFF} ${vCh} + ${vDis} = 0`);
            }
        }

        const vUnserved = `u_${i}`;
        vars.add(vUnserved);
        objective.push(`+ ${VOLL * weight} ${vUnserved}`);
        balanceLHS.push(`+ ${vUnserved}`);

        constraints.push(`bal_${i}: ${balanceLHS.join(' ')} = ${hourData.demand}`);
    }

    // Min Renewables Constraint
    // Implementation: Sum(Gen_NonRez * weight) <= TotalDemand * (1 - limit)
    // Non-Rez: nuclear, coal, gas_ccgt, gas_ocgt, diesel
    // Hydrogen is debatable but let's count it as clean/flex for now? Or dirty peaker?
    // User request: "max constraint on other generation... fossil + nukes + other"
    // So excluding Solar, Wind, Offshore, Battery.
    // What about Hydrogen? Let's check type.

    if (minRenewables > 0) {
        let nonRezGenTerms = [];
        let totalAnnualDemand = 0;

        enabledTechs.forEach(tech => {
            // Count as Non-Renewable if not renewable and not storage
            // This treats Hydrogen as "Non-Renewable" (Other) which is safe for this specific request context "fossil + nukes + other"
            if (tech.type !== 'renewable' && tech.type !== 'storage') {
                for (let i = 0; i < TOTAL_HOURS; i++) {
                    const row = flatData[i];
                    if (row.includeInStats) {
                        const weight = row.weight || 0;
                        nonRezGenTerms.push(`+ ${weight} g_${tech.id}_${i}`);
                    }
                }
            }
        });

        for (let i = 0; i < TOTAL_HOURS; i++) {
            const row = flatData[i];
            if (row.includeInStats) {
                totalAnnualDemand += row.demand * (row.weight || 0);
            }
        }

        const maxNonRez = totalAnnualDemand * (1 - minRenewables / 100);

        // Only valid if we have non-renewable techs enabled
        if (nonRezGenTerms.length > 0) {
            constraints.push(`min_res_global: ${nonRezGenTerms.join(' ')} <= ${maxNonRez}`);
        }
    }

    vars.forEach(v => bounds.push(`${v} >= 0`));

    const lp = `Minimize
obj: ${objective.join(' ')}

Subject To
${constraints.join('\n')}

Bounds
${bounds.join('\n')}

End`;

    return { lp, vars: Array.from(vars), flatData };
}

function optimizeWithHiGHS(techs, dataChunks, minRenewables = 0) {
    const { lp, flatData } = buildLPModel(techs, dataChunks, minRenewables);

    console.time('HiGHS Solve');
    const result = highsSolver.solve(lp);
    console.timeEnd('HiGHS Solve');

    if (result.Status !== 'Optimal') {
        console.error('Solver status:', result.Status);
        throw new Error(`Solver failed: ${result.Status}`);
    }

    const solution = result.Columns;
    const enabledTechs = Object.values(techs).filter(t => t.enabled);

    const capacities = {};
    enabledTechs.forEach(t => {
        if (t.type === 'storage') {
            // Battery: energy capacity in MWh
            capacities[t.id] = solution[`e_${t.id}`]?.Primal || 0;
        } else {
            // Others: power capacity in MW
            capacities[t.id] = solution[`c_${t.id}`]?.Primal || 0;
        }
    });

    const hourlyResults = [];
    const mix = {};
    let totalCo2 = 0;
    let annualDemand = 0;
    let annualUnserved = 0;

    for (let i = 0; i < flatData.length; i++) {
        const row = { ...flatData[i] };

        if (row.includeInStats) {
            annualDemand += row.demand * row.weight;
        }

        let hourlyCurtailment = 0;

        enabledTechs.forEach(t => {
            if (t.type === 'storage') return;
            const gen = solution[`g_${t.id}_${i}`]?.Primal || 0;

            // ... (existing assignments)
            if (t.id === 'SOLAR') row.solarGen = gen;
            if (t.id === 'WIND') row.windGen = gen;
            if (t.id === 'WIND_OFFSHORE') row.offshoreGen = gen;
            if (t.id === 'NUCLEAR') row.nuclearGen = gen;
            if (t.id === 'COAL') row.coalGen = gen;
            if (t.id === 'GAS_CCGT') row.gasCcgtGen = gen;
            if (t.id === 'GAS_OCGT') row.gasOcgtGen = gen;
            if (t.id === 'HYDROGEN') row.hydrogenGen = gen;
            if (t.id === 'DIESEL') row.dieselGen = gen;

            // Curtailment Calc
            if (t.type === 'renewable') {
                let profile = 0;
                if (t.id === 'SOLAR') profile = row.solar;
                if (t.id === 'WIND') profile = row.wind;
                if (t.id === 'WIND_OFFSHORE') profile = row.offshore;

                const capacity = capacities[t.id] || 0;
                const potential = capacity * profile;
                if (potential > gen + 0.001) {
                    hourlyCurtailment += (potential - gen);
                }
            }

            if (row.includeInStats) {
                const weightedGen = gen * row.weight;
                mix[t.id] = (mix[t.id] || 0) + weightedGen;
                totalCo2 += weightedGen * t.co2;
            }
        });

        const batt = enabledTechs.find(t => t.type === 'storage');
        if (batt) {
            // ... existing battery logic
            row.batteryCharge = solution[`b_ch_${i}`]?.Primal || 0;
            row.batteryDischarge = solution[`b_dis_${i}`]?.Primal || 0;
            row.batterySoC = solution[`b_soc_${i}`]?.Primal || 0;

            if (row.includeInStats) {
                mix['BATTERY'] = (mix['BATTERY'] || 0) + (row.batteryDischarge * row.weight);
            }
        }

        row.shortfall = solution[`u_${i}`]?.Primal || 0;
        row.curtailment = hourlyCurtailment;

        if (row.includeInStats) {
            annualUnserved += row.shortfall * row.weight;
        }

        hourlyResults.push(row);
    }

    // Recalculate Total Cost for Annual Stats
    let totalFixedCost = 0;
    enabledTechs.forEach(t => {
        if (t.type === 'storage') {
            // Battery: Capacity is MWh. Need $/MWh/yr cost.
            // Cost Model:
            // Capex: $/kWh -> $/MWh = * 1000
            // Opex: $/kW -> $/kWh = / duration -> $/MWh = * 1000 / duration

            const duration = t.duration || 4;
            const costPerKwh = t.capexPerKwh || (t.capex / duration);

            // Annualize Capex
            const r = t.wacc / 100;
            const n = t.lifetime;
            let annualizedCapexPerKwh = 0;
            if (n > 0) {
                if (r === 0) annualizedCapexPerKwh = costPerKwh / n;
                else {
                    const crf = (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
                    annualizedCapexPerKwh = costPerKwh * crf;
                }
            }

            // Opex (Fixed) - Provided in $/kW-yr. Convert to $/kWh-yr.
            const opexPerKwh = (t.opexFixed || 0) / duration;

            const totalAnnualCostPerMwh = (annualizedCapexPerKwh + opexPerKwh) * 1000;

            totalFixedCost += totalAnnualCostPerMwh * capacities[t.id];

        } else {
            // Standard: MW * $/MW/yr
            totalFixedCost += (getAnnualFixedCost(t) * 1000) * capacities[t.id];
        }
    });

    let totalVariableCost = 0;
    for (let i = 0; i < flatData.length; i++) {
        const row = flatData[i];
        if (!row.includeInStats) continue;

        const w = row.weight;
        enabledTechs.forEach(t => {
            if (t.type === 'storage') return;
            let g = solution[`g_${t.id}_${i}`]?.Primal || 0;
            totalVariableCost += g * getMarginalCost(t) * w;
        });

        const batt = enabledTechs.find(t => t.type === 'storage');
        if (batt) {
            totalVariableCost += (solution[`b_ch_${i}`]?.Primal || 0) * 0.1 * w;
        }
        totalVariableCost += (solution[`u_${i}`]?.Primal || 0) * 20000000 * w;
    }

    const reportingTotalCost = totalFixedCost + totalVariableCost;
    const totalServed = Math.max(0.1, annualDemand - annualUnserved);
    const lcoe = reportingTotalCost / totalServed;

    return { hourly: hourlyResults, totalCost: reportingTotalCost, lcoe, totalCo2, mix, capacities, unservedEnergy: annualUnserved, annualServed: totalServed };
}

app.post('/api/optimize', (req, res) => {
    try {
        const { techs, demandProfile = 'spain', region = 'es', minRenewables = 0 } = req.body;
        if (!techs) return res.status(400).json({ error: 'Missing techs' });
        if (!highsSolver) return res.status(503).json({ error: 'Solver not ready' });

        const weeks = WEEK_CONFIGS[region] || WEEK_CONFIGS['es'];
        const dataChunks = weeks.map(w => getWeekData(w, demandProfile, region));

        const result = optimizeWithHiGHS(techs, dataChunks, minRenewables);
        res.json(result);
    } catch (error) {
        console.error('Optimization error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', dataLoaded: DATASETS.es.solar.length > 0, solverReady: !!highsSolver });
});

app.get('/api/weeks', (req, res) => {
    res.json(WEEK_CONFIGS);
});

// Catch-all route for SPA - serve index.html for any non-API routes
app.get('*', (req, res) => {
    const indexPath = path.join(__dirname, '../dist/index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).send('Frontend not built. Run npm run build first.');
    }
});

loadData().then(() => {
    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT} (Multi-region: ES, GB, FR)`);
    });
});
