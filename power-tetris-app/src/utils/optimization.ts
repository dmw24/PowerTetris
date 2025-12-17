import { TechType } from '../types';
import type { TechDefinition, HourlyData, SimulationResult } from '../types';
import { HOURS_IN_WEEK } from '../constants';
import solver from 'javascript-lp-solver';

export function getWeeklyFixedCost(tech: TechDefinition): number {
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

    const annualFixedOpex = tech.opexFixed;
    const totalAnnualFixed = annualizedCapex + annualFixedOpex;
    return totalAnnualFixed / 52; // Weekly $/kW
}

// Helper: Marginal Cost ($/MWh)
const getMarginalCost = (tech: TechDefinition): number => {
    return tech.opexVar + tech.fuelCost;
};

// MULTI-WEEK OPTIMIZATION
export const optimizeCapacityExpansion = (
    techs: Record<TechType, TechDefinition>,
    dataChunks: HourlyData[][] // Array of 4 weeks (168 hours each)
): SimulationResult => {

    // Guard against empty data
    if (!dataChunks || dataChunks.length === 0) {
        // Return empty result
        return {
            hourly: [],
            totalCost: 0,
            lcoe: 0,
            totalCo2: 0,
            mix: {
                [TechType.SOLAR]: 0, [TechType.WIND]: 0, [TechType.WIND_OFFSHORE]: 0, [TechType.BATTERY]: 0,
                [TechType.NUCLEAR]: 0, [TechType.COAL]: 0, [TechType.GAS_CCGT]: 0,
                [TechType.GAS_OCGT]: 0, [TechType.HYDROGEN]: 0, [TechType.DIESEL]: 0
            },
            capacities: {
                [TechType.SOLAR]: 0, [TechType.WIND]: 0, [TechType.WIND_OFFSHORE]: 0, [TechType.BATTERY]: 0,
                [TechType.NUCLEAR]: 0, [TechType.COAL]: 0, [TechType.GAS_CCGT]: 0,
                [TechType.GAS_OCGT]: 0, [TechType.HYDROGEN]: 0, [TechType.DIESEL]: 0
            },
            unservedEnergy: 0
        };
    }

    const enabledTechs = Object.values(techs).filter(t => t.enabled);
    const VOLL = 10000; // Value of Lost Load ($/MWh) - Higher to force capacity build
    const BATTERY_DURATION = 4; // hours
    const BATTERY_EFF = 0.9;
    const WEEKS_COUNT = dataChunks.length;

    // Flatten data for easier iteration, but keep track of indices
    const flattenedData = dataChunks.flat();
    const TOTAL_HOURS = flattenedData.length;

    // 1. Setup Model
    const model: any = {
        optimize: "cost",
        opType: "min",
        constraints: {},
        variables: {}
    };

    // 2. Global Capacity Variables (The Decision Variables)
    // Cost = WeeklyFixedCost * WEEKS_COUNT
    enabledTechs.forEach(tech => {
        const v_cap = `c_${tech.id}`;
        // We multiply by WEEKS_COUNT because this capacity exists for all simulated weeks
        // and we are minimizing Total Cost over this period.
        model.variables[v_cap] = {
            cost: getWeeklyFixedCost(tech) * 1000 * WEEKS_COUNT
        };
    });


    // 3. Build Hourly Constraints
    for (let i = 0; i < TOTAL_HOURS; i++) {
        const hourData = flattenedData[i];

        // Names
        const c_balance = `bal_${i}`;
        const c_soc_dyn = `soc_dyn_${i}`;
        const c_soc_max = `soc_max_${i}`;

        // Balance Constraint
        model.constraints[c_balance] = { equal: hourData.demand };

        // SoC Constraints (if storage exists)
        const hasStorage = enabledTechs.some(t => t.type === 'storage');
        if (hasStorage) {
            model.constraints[c_soc_dyn] = { equal: 0 };
            model.constraints[c_soc_max] = { max: 0 };
        }

        // --- Generation Techs ---
        enabledTechs.forEach(tech => {
            if (tech.type === 'storage') return;

            const v_gen = `g_${tech.id}_${i}`;
            const c_cap_limit = `cap_${tech.id}_${i}`; // Gen <= Cap

            model.variables[v_gen] = {
                cost: getMarginalCost(tech), // Operational cost
                [c_balance]: 1,
                [c_cap_limit]: 1,
            };

            model.constraints[c_cap_limit] = { max: 0 };

            // Link to Global Capacity
            const v_cap = `c_${tech.id}`;

            if (tech.type === 'renewable') {
                const profile = tech.id === TechType.SOLAR ? hourData.solar : hourData.wind;
                // Gen - Cap * profile <= 0
                model.variables[v_cap][c_cap_limit] = -1 * (profile || 0);
            } else {
                // Gen - Cap <= 0
                model.variables[v_cap][c_cap_limit] = -1;
            }
        });

        // --- Storage ---
        const battTech = enabledTechs.find(t => t.type === 'storage');
        if (battTech) {
            const v_ch = `b_ch_${i}`;
            const v_dis = `b_dis_${i}`;
            const v_soc = `b_soc_${i}`;
            const v_cap_batt = `c_${battTech.id}`;

            // Charge
            model.variables[v_ch] = {
                cost: 0.1,
                [c_balance]: -1,
                [c_soc_dyn]: -1 * BATTERY_EFF,
            };

            // Discharge
            model.variables[v_dis] = {
                cost: 0,
                [c_balance]: 1,
                [c_soc_dyn]: 1,
            };

            // SoC State
            model.variables[v_soc] = {
                cost: 0,
                [c_soc_dyn]: 1,
                [c_soc_max]: 1,
            };

            // Link SoC
            // Check if this hour is the start of a new week chunk
            const isWeekStart = i % HOURS_IN_WEEK === 0;

            if (!isWeekStart) {
                // Link to previous hour
                // The Variable v_soc_{i-1} adds -1 to this constraint
                // Logic: SoC_t - SoC_{t-1} ... = 0
                // Previous variable v_soc_{i-1} needs to have -1 in `soc_dyn_i`
                // We can't access v_soc_prev easily here without storing structure.
                // Better approach:
                // SoC Constraint `soc_dyn_{i}`:
                // +1 * SoC_{i} 
                // -1 * SoC_{i-1}
                // +1 * Dis
                // -eff * Ch
                // = 0

                // So for `v_soc`, we add +1 to current `soc_dyn_i`
                // And -1 to NEXT `soc_dyn_{i+1}`

                if (i < TOTAL_HOURS - 1 && (i + 1) % HOURS_IN_WEEK !== 0) {
                    const c_soc_dyn_next = `soc_dyn_${i + 1}`;
                    model.variables[v_soc][c_soc_dyn_next] = -1;
                }
            } else {
                // It's start of a week.
                // Constraint `soc_dyn_{i}` is SoC_{i} ...
                // Does it link to last hour of THIS week? (Cyclic)
                // i + 167 is the last hour of this week.
                // We need SoC_0 - SoC_Last = 0? Or SoC_0 is fixed?
                // Let's assume Cyclic daily/weekly.
                // SoC_First - SoC_Last + ... = 0 ??
                // Standard Cyclic: SoC_{0} = SoC_{T}
                // Implementation:
                // v_soc_{T} contributes -1 to `soc_dyn_{0}`

            }

            // Handle the "Forward Link" (-1 to next hour)
            // If i is NOT the last hour of a week
            if ((i + 1) % HOURS_IN_WEEK !== 0) {
                const c_soc_dyn_next = `soc_dyn_${i + 1}`;
                model.variables[v_soc][c_soc_dyn_next] = -1;
            } else {
                // i IS the last hour of a week.
                // Link back to the FIRST hour of THIS week (Cyclic)
                const startOfWeekIndex = i - (HOURS_IN_WEEK - 1);
                const c_soc_dyn_start = `soc_dyn_${startOfWeekIndex}`;
                model.variables[v_soc][c_soc_dyn_start] = -1;
            }

            // Constraints
            const c_ch_limit = `ch_lim_${i}`;
            const c_dis_limit = `dis_lim_${i}`;
            model.constraints[c_ch_limit] = { max: 0 };
            model.constraints[c_dis_limit] = { max: 0 };

            model.variables[v_ch][c_ch_limit] = 1;
            model.variables[v_cap_batt][c_ch_limit] = -1; // Ch <= Cap

            model.variables[v_dis][c_dis_limit] = 1;
            model.variables[v_cap_batt][c_dis_limit] = -1; // Dis <= Cap

            // SoC Capacity
            model.variables[v_cap_batt][c_soc_max] = -1 * BATTERY_DURATION;
        }

        // Unserved
        const v_unserved = `u_${i}`;
        model.variables[v_unserved] = {
            cost: VOLL,
            [c_balance]: 1
        };
    }

    // 4. Solve
    try {
        const solverInstance = (solver as any).default || solver;
        const solution = solverInstance.Solve(model);

        // 5. Extract Results

        // Capacities
        const capacities: Record<TechType, number> = {} as any;
        enabledTechs.forEach(t => {
            capacities[t.id] = solution[`c_${t.id}`] || 0;
        });
        // Fill missing with 0
        Object.values(TechType).forEach((id) => {
            if (!capacities[id as TechType]) capacities[id as TechType] = 0;
        });

        const hourlyResults: HourlyData[] = [];
        const mix: Record<TechType, number> = {} as any;
        Object.values(TechType).forEach(id => mix[id as TechType] = 0);

        let totalCo2 = 0;
        let totalDemand = 0;

        for (let i = 0; i < TOTAL_HOURS; i++) {
            const row: any = { ...flattenedData[i] };
            totalDemand += row.demand;

            enabledTechs.forEach(t => {
                if (t.type === 'storage') return;
                const gen = solution[`g_${t.id}_${i}`] || 0;

                if (t.id === TechType.SOLAR) row.solarGen = gen;
                if (t.id === TechType.WIND) row.windGen = gen;
                if (t.id === TechType.NUCLEAR) row.nuclearGen = gen;
                if (t.id === TechType.COAL) row.coalGen = gen;
                if (t.id === TechType.GAS_CCGT) row.gasCcgtGen = gen;
                if (t.id === TechType.GAS_OCGT) row.gasOcgtGen = gen;
                if (t.id === TechType.HYDROGEN) row.hydrogenGen = gen;
                if (t.id === TechType.DIESEL) row.dieselGen = gen;

                mix[t.id] += gen;
                totalCo2 += gen * t.co2;

                // Curtailment
                if (t.type === 'renewable') {
                    const profile = t.id === TechType.SOLAR ? row.solar : row.wind;
                    const potential = capacities[t.id] * profile;
                    row.curtailment = (row.curtailment || 0) + Math.max(0, potential - gen);
                }
            });

            // Battery
            const batt = enabledTechs.find(t => t.type === 'storage');
            if (batt) {
                row.batteryCharge = solution[`b_ch_${i}`] || 0;
                row.batteryDischarge = solution[`b_dis_${i}`] || 0;
                row.batterySoC = solution[`b_soc_${i}`] || 0;
                mix[TechType.BATTERY] += row.batteryDischarge;
            }

            row.shortfall = solution[`u_${i}`] || 0;
            hourlyResults.push(row);
        }

        const totalCost = solution.result || 0;
        const unservedEnergy = hourlyResults.reduce((a, b) => a + (b.shortfall || 0), 0);
        const totalServed = Math.max(0.1, totalDemand - unservedEnergy);
        const lcoe = totalCost / totalServed;

        return {
            hourly: hourlyResults,
            totalCost,
            lcoe,
            totalCo2,
            mix,
            capacities,
            unservedEnergy
        }

    } catch (e) {
        console.error("Solver Error", e);
        return {
            hourly: [],
            totalCost: 0,
            lcoe: 0,
            totalCo2: 0,
            mix: {} as any,
            capacities: {} as any,
            unservedEnergy: 0
        }
    }
};
