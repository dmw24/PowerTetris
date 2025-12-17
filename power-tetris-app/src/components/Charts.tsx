import React, { useMemo, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, Legend, BarChart, Bar, Cell, ComposedChart } from 'recharts';
import type { SimulationResult, TechDefinition, RepresentativeWeek } from '../types';
import { TechType } from '../types';

interface ChartsProps {
    result: SimulationResult;
    techs: Record<TechType, TechDefinition>;
    weekIndex: number;
    weeks: RepresentativeWeek[];
    setWeekIndex: (i: number) => void;
}

const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
        // Special handling for Waterfall tooltip which might have array values
        const isWaterfall = payload[0]?.payload?.isWaterfall;
        const isGenerationStack = payload[0]?.payload?.isGenerationStack;
        const isTechLcoe = payload[0]?.payload?.isTechLCOE;

        return (
            <div className="bg-white/95 backdrop-blur p-4 border border-slate-200 shadow-xl rounded-lg text-xs leading-5 z-50 min-w-[200px]">
                <p className="font-bold mb-2 text-slate-600 border-b pb-1">{label}</p>
                <div className="space-y-1">
                    {payload.map((p: any, i: number) => {
                        // Skip zero values or hidden helpers
                        if ((Math.abs(p.value) < 0.01 && !Array.isArray(p.value)) || p.dataKey === 'transparentPlaceholder') return null;

                        let valueDisplay = '';
                        let nameDisplay = p.name;

                        if (isWaterfall) {
                            // For waterfall, value is [start, end], we want the diff
                            const val = Array.isArray(p.value) ? p.value[1] - p.value[0] : p.value;
                            valueDisplay = `$${val.toFixed(2)} /MWh`;
                        } else if (isTechLcoe) {
                            valueDisplay = `$${(p.value as number).toFixed(2)} /MWh`;
                        } else if (isGenerationStack) {
                            const totalMwh = p.payload?.mwhMap?.[p.name] || 0;
                            valueDisplay = `${(p.value as number).toFixed(1)}% (${Math.round(totalMwh).toLocaleString()} MWh)`;
                        } else {
                            valueDisplay = `${Math.round(Math.abs(p.value as number)).toLocaleString()} MW`;
                        }

                        return (
                            <div key={i} className="flex items-center justify-between gap-4">
                                <div className="flex items-center gap-1.5">
                                    <div className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ background: p.color }} />
                                    <span className="text-slate-600">{nameDisplay}</span>
                                </div>
                                <span className="font-mono font-medium text-slate-900">{valueDisplay}</span>
                            </div>
                        )
                    })}
                </div>
            </div>
        );
    }
    return null;
};

export const Charts: React.FC<ChartsProps> = ({ result, techs, weekIndex, setWeekIndex, weeks }) => {
    const [viewMode, setViewMode] = useState<'dispatch' | 'capacity' | 'generation' | 'cost'>('dispatch');

    // --- Data Preparation for Dispatch Chart ---
    const currentChunkIndex = useMemo(() => {
        const idx = weeks.findIndex(w => w.startHour === weekIndex);
        return idx >= 0 ? idx : 0;
    }, [weekIndex]);

    const dispatchData = useMemo(() => {
        const start = currentChunkIndex * 168;
        const end = start + 168;
        const chunk = result.hourly.slice(start, end);

        return chunk.map((h, i) => {
            return {
                name: i,
                fullDate: h.time ? new Date(h.time).toLocaleString() : `Hour ${h.hour}`,
                demand: h.demand,
                Solar: h.solarGen || 0,
                Wind: h.windGen || 0,
                OffshoreWind: h.offshoreGen || 0,
                Nuclear: h.nuclearGen || 0,
                Coal: h.coalGen || 0,
                GasCCGT: h.gasCcgtGen || 0,
                GasOCGT: h.gasOcgtGen || 0,
                Hydrogen: h.hydrogenGen || 0,
                Diesel: h.dieselGen || 0,
                BatteryDischarge: h.batteryDischarge || 0,
                BatteryCharge: -1 * (h.batteryCharge || 0),
                Shortfall: h.shortfall || 0,
                Curtailment: h.curtailment || 0,
            };
        });
    }, [result, currentChunkIndex]);

    // --- Data Preparation for Capacity Chart ---
    const capacityData = useMemo(() => {
        const peakLoad = Math.max(...result.hourly.map(h => h.demand));

        // Define firm techs (excluding variable renewables)
        // Battery is usually considered firm (limited duration) or flexibility. The prompt asks for "all firm capacity stacked".
        // Often Solar/Wind are not firm. Nuclear, Gas, Coal, Diesel, Hydrogen, Battery are firm.
        const firmTechs = [TechType.NUCLEAR, TechType.COAL, TechType.GAS_CCGT, TechType.GAS_OCGT, TechType.HYDROGEN, TechType.DIESEL, TechType.BATTERY];

        // Create a single data object for 'Total' and 'Firm' stacks? 
        // Or two separate bars on X axis: "Total System" and "Firm Capacity".

        const totalStack = { name: 'Installed Capacity', peakLoad };
        const firmStack = { name: 'Firm Capacity', peakLoad };

        // Populate Total Stack
        Object.values(techs).forEach(t => {
            // @ts-ignore
            totalStack[t.name] = t.installedCapacity || 0;
        });

        // Populate Firm Stack
        firmTechs.forEach(id => {
            if (techs[id].installedCapacity > 0) {
                // @ts-ignore
                firmStack[techs[id].name] = techs[id].installedCapacity;
            }
        });

        return [totalStack, firmStack];

    }, [result, techs]);

    // Annual generation share (stack to 100%)
    const generationData = useMemo(() => {
        const includedTechs = Object.values(techs).filter(t => t.type !== 'storage');
        const totalGen = includedTechs.reduce((sum, t) => sum + (result.mix[t.id] || 0), 0);
        const row: any = { name: 'Annual Generation', isGenerationStack: true, mwhMap: {} };

        includedTechs.forEach(t => {
            const gen = result.mix[t.id] || 0;
            if (gen <= 0 || totalGen <= 0) return;
            const pct = (gen / totalGen) * 100;
            row[t.name] = pct;
            row.mwhMap[t.name] = gen;
        });

        return [row];
    }, [result.mix, techs]);


    // --- DATA PREPARATION FOR CHARTS ---

    // Helper to calc annual fixed cost ($/kW/yr)
    const getAnnualFixedCostStrp = (tech: TechDefinition) => {
        const r = tech.wacc / 100;
        const n = tech.lifetime;
        let annualizedCapex = 0;
        if (n > 0) {
            if (r === 0) annualizedCapex = tech.capex / n;
            else {
                const crf = (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
                annualizedCapex = tech.capex * crf;
            }
        }
        return annualizedCapex + tech.opexFixed; // $/kW/yr
    };
    // Storage-specific annual fixed cost using energy capacity (MWh), aligned with backend accounting
    const getStorageAnnualFixedCost = (tech: TechDefinition, energyMWh: number) => {
        const duration = tech.duration || 4;
        const capexPerKwh = tech.capexPerKwh || (tech.capex / duration);
        const r = tech.wacc / 100;
        const n = tech.lifetime;
        let annualizedCapexPerKwh = 0;
        if (n > 0) {
            if (r === 0) annualizedCapexPerKwh = capexPerKwh / n;
            else {
                const crf = (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
                annualizedCapexPerKwh = capexPerKwh * crf;
            }
        }
        const opexPerKwh = (tech.opexFixed || 0) / duration;
        const totalAnnualCostPerMwh = (annualizedCapexPerKwh + opexPerKwh) * 1000; // $/MWh/yr
        return totalAnnualCostPerMwh * energyMWh;
    };

    // Global Annual Demand (Weighted)
    const totalAnnualServed = result.annualServed || 1; // Avoid div/0
    const serverLcoe = result.lcoe;

    // A. System LCOE Waterfall Data
    const waterfallData = useMemo(() => {
        let cumulativeLCOE = 0;
        const dataPoints: any[] = [];

        const sortedTechs = Object.values(techs)
            .filter(t => t.enabled && (result.capacities[t.id] || 0) > 0)
            .sort((a, b) => (result.mix[b.id] || 0) - (result.mix[a.id] || 0)); // Sort by generation

        sortedTechs.forEach(t => {
            const capacityVal = result.capacities[t.id] || 0; // MW for gen, MWh for battery (matches backend)
            const genMWh = result.mix[t.id] || 0;

            // Annual Fixed ($) matches backend accounting
            const annualFixed = t.type === 'storage'
                ? getStorageAnnualFixedCost(t, capacityVal)
                : (getAnnualFixedCostStrp(t) * 1000) * capacityVal;

            // Annual Variable ($) = MWh * ($/MWh)
            const annualVariable = t.type === 'storage'
                ? (genMWh / 0.9) * 0.1 // charge cost only; aligns with backend
                : genMWh * (t.opexVar + t.fuelCost);

            // Contributions to System LCOE ($/MWh_system)
            const sunFixed = annualFixed / totalAnnualServed;
            const sunVar = annualVariable / totalAnnualServed;

            const total = sunFixed + sunVar;

            if (total < 0.01) return; // Skip negligible

            const start = cumulativeLCOE;
            cumulativeLCOE += total;

            dataPoints.push({
                name: t.name,
                color: t.color,
                isWaterfall: true,
                // For "floating" bar, we need [min, max]
                capexRange: [start, start + sunFixed],
                opexRange: [start + sunFixed, start + sunFixed + sunVar],
                // For tooltip
                capexVal: sunFixed,
                opexVal: sunVar,
                totalVal: total
            });
        });

        // Add Unserved Energy Penalty if significant
        const annualUnserved = result.unservedEnergy || 0;
        if (annualUnserved > 1) { // Threshold
            const costUnserved = annualUnserved * 10000; // VOLL
            const sunUnserved = costUnserved / totalAnnualServed;
            const start = cumulativeLCOE;
            cumulativeLCOE += sunUnserved;
            dataPoints.push({
                name: 'Unserved Energy',
                color: '#ef4444',
                isWaterfall: true,
                capexRange: [start, start], // No capex for unserved
                opexRange: [start, start + sunUnserved],
                capexVal: 0,
                opexVal: sunUnserved,
                totalVal: sunUnserved
            });
        }

        // Final Total Bar
        const totalLcoe = serverLcoe || cumulativeLCOE;
        dataPoints.push({
            name: 'Total LCOE',
            isWaterfall: true,
            totalRange: [0, totalLcoe], // Use backend-reported LCOE to stay consistent with headline metric
            totalVal: totalLcoe,
            color: '#0f172a' // Slate-900
        });

        return dataPoints;
    }, [result, techs, totalAnnualServed, serverLcoe]);


    // B. Tech LCOE Stacked Data ($/MWh_tech)
    // "How much does 1 MWh of this tech cost?"
    const techLcoeData = useMemo(() => {
        return Object.values(techs)
            .filter(t => t.enabled && (result.mix[t.id] || 0) > 10) // Filter unused or very low generation
            .map(t => {
                const capacityVal = result.capacities[t.id] || 0; // MW for gen, MWh for battery
                const genMWh = result.mix[t.id] || 0;

                // Costs ($) consistent with backend
                const annualFixed = t.type === 'storage'
                    ? getStorageAnnualFixedCost(t, capacityVal)
                    : (getAnnualFixedCostStrp(t) * 1000) * capacityVal;

                const annualVariable = t.type === 'storage'
                    ? (genMWh / 0.9) * 0.1
                    : genMWh * (t.opexVar + t.fuelCost);

                // Unit Costs ($/MWh_tech)
                const unitFixed = genMWh > 0 ? annualFixed / genMWh : 0;
                const unitVar = genMWh > 0 ? annualVariable / genMWh : 0;

                return {
                    name: t.name,
                    color: t.color,
                    isTechLCOE: true,
                    unitFixed: unitFixed,
                    unitVar: unitVar,
                    total: unitFixed + unitVar
                };
            }).sort((a, b) => a.total - b.total);
    }, [result, techs]);

    const [costViewMode, setCostViewMode] = useState<'waterfall' | 'stacked'>('waterfall');

    return (
        <div className="w-full h-full flex flex-col bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            {/* Header / Controls */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                <div className="flex items-center gap-6">
                    {/* View Switcher */}
                    <div className="bg-slate-200 p-1 rounded-lg flex gap-1">
                        <button
                            onClick={() => setViewMode('dispatch')}
                            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${viewMode === 'dispatch' ? 'bg-white text-ember-teal shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            Weekly Dispatch
                        </button>
                        <button
                            onClick={() => setViewMode('capacity')}
                            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${viewMode === 'capacity' ? 'bg-white text-ember-teal shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            Installed Capacity
                        </button>
                        <button
                            onClick={() => setViewMode('generation')}
                            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${viewMode === 'generation' ? 'bg-white text-ember-teal shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            Annual Generation
                        </button>
                        <button
                            onClick={() => setViewMode('cost')}
                            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${viewMode === 'cost' ? 'bg-white text-ember-teal shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            Cost
                        </button>
                    </div>

                    {/* Sub-toggle for Dispatch */}
                    {viewMode === 'dispatch' && (
                        <div className="flex bg-slate-200/50 p-1 rounded-lg ml-4 border border-slate-200">
                            {weeks.map((w) => (
                                <button
                                    key={w.startHour}
                                    onClick={() => setWeekIndex(w.startHour)}
                                    className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${weekIndex === w.startHour
                                        ? 'bg-white text-slate-700 shadow-sm'
                                        : 'text-slate-400 hover:text-slate-600'
                                        }`}
                                >
                                    {w.label}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Sub-toggle for Cost */}
                    {viewMode === 'cost' && (
                        <div className="flex bg-slate-200/50 p-1 rounded-lg ml-4 border border-slate-200">
                            <button
                                onClick={() => setCostViewMode('waterfall')}
                                className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${costViewMode === 'waterfall' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                            >
                                System LCOE (Waterfall)
                            </button>
                            <button
                                onClick={() => setCostViewMode('stacked')}
                                className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${costViewMode === 'stacked' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                            >
                                Tech LCOE (Stacked)
                            </button>
                        </div>
                    )}
                </div>

                {/* Metrics */}
                <div className="flex gap-6 text-xs text-slate-500">
                    <div className="flex flex-col items-end">
                        <span className="font-bold text-green-600 text-lg">{(() => {
                            const renewable = (result.mix['SOLAR'] || 0) + (result.mix['WIND'] || 0) + (result.mix['WIND_OFFSHORE'] || 0);
                            const total = Object.entries(result.mix)
                                .filter(([key]) => {
                                    return key !== 'BATTERY'; // exclude storage discharge from generation total
                                })
                                .reduce((a, [, b]) => a + (b || 0), 0);
                            return total > 0 ? ((renewable / total) * 100).toFixed(0) : 0;
                        })()}%</span>
                        <span>Renewable Share</span>
                    </div>
                    <div className="flex flex-col items-end">
                        <span className="font-bold text-ember-teal text-lg">${result.lcoe.toFixed(2)}</span>
                        <span>LCOE ($/MWh)</span>
                    </div>
                </div>
            </div>

            {/* Chart Area */}
            <div className="flex-1 p-4 min-h-0 relative">
                <ResponsiveContainer width="100%" height="100%">
                    {viewMode === 'dispatch' ? (
                        <AreaChart data={dispatchData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                            <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval={23} />
                            <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v / 1000}k`} />
                            <Tooltip content={<CustomTooltip />} />
                            <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                            <defs>
                                <linearGradient id="batteryCharge" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.6} />
                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.1} />
                                </linearGradient>
                            </defs>
                            <Area type="monotone" dataKey="Solar" stackId="1" stroke="none" fill={techs[TechType.SOLAR].color} />
                            <Area type="monotone" dataKey="Wind" stackId="1" stroke="none" fill={techs[TechType.WIND].color} />
                            <Area type="monotone" dataKey="OffshoreWind" stackId="1" stroke="none" fill={techs[TechType.WIND_OFFSHORE].color} />
                            <Area type="monotone" dataKey="Nuclear" stackId="1" stroke="none" fill={techs[TechType.NUCLEAR].color} />
                            <Area type="monotone" dataKey="BatteryDischarge" stackId="1" stroke="none" fill={techs[TechType.BATTERY].color} name="Battery Discharge" />
                            <Area type="monotone" dataKey="GasCCGT" stackId="1" stroke="none" fill={techs[TechType.GAS_CCGT].color} />
                            <Area type="monotone" dataKey="Coal" stackId="1" stroke="none" fill={techs[TechType.COAL].color} />
                            <Area type="monotone" dataKey="GasOCGT" stackId="1" stroke="none" fill={techs[TechType.GAS_OCGT].color} />
                            <Area type="monotone" dataKey="Diesel" stackId="1" stroke="none" fill={techs[TechType.DIESEL].color} />
                            <Area type="monotone" dataKey="Hydrogen" stackId="1" stroke="none" fill={techs[TechType.HYDROGEN].color} />
                            <Area type="monotone" dataKey="Shortfall" stackId="1" stroke="none" fill="#ef4444" />
                            <Area type="monotone" dataKey="Curtailment" stackId="1" stroke="none" fill="#94a3b8" fillOpacity={0.5} name="Overproduction / Curtailment" />
                            <Line type="monotone" dataKey="demand" stroke="#1e293b" strokeWidth={2} dot={false} name="Demand" style={{ filter: 'drop-shadow(0px 2px 2px rgba(0,0,0,0.1))' }} />
                            <Area type="monotone" dataKey="BatteryCharge" stackId="2" stroke="none" fill="url(#batteryCharge)" name="Battery Charge" />
                        </AreaChart>

                    ) : viewMode === 'capacity' ? (
                        <ComposedChart data={capacityData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                            <XAxis dataKey="name" tick={{ fontSize: 12, fontWeight: 500 }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v / 1000} GW`} label={{ value: 'MW', angle: -90, position: 'insideLeft', style: { fill: '#94a3b8' } }} />
                            <Tooltip content={<CustomTooltip />} />
                            <Legend />
                            {[
                                TechType.SOLAR, TechType.WIND, TechType.WIND_OFFSHORE,
                                TechType.NUCLEAR, TechType.COAL, TechType.GAS_CCGT,
                                TechType.GAS_OCGT, TechType.DIESEL, TechType.HYDROGEN,
                                TechType.BATTERY
                            ].map(id => (
                                <Bar key={id} dataKey={techs[id].name} stackId="a" fill={techs[id as TechType].color} />
                            ))}

                            <Line type="monotone" dataKey="peakLoad" stroke="#ef4444" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Peak Load" />
                        </ComposedChart>
                    ) : viewMode === 'generation' ? (
                        <BarChart data={generationData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                            <XAxis dataKey="name" tick={{ fontSize: 12, fontWeight: 500 }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} label={{ value: 'Annual Generation (%)', angle: -90, position: 'insideLeft', style: { fill: '#94a3b8' } }} />
                            <Tooltip content={<CustomTooltip />} />
                            <Legend />
                            {Object.values(TechType)
                                .filter(id => techs[id as TechType].type !== 'storage')
                                .map(id => (
                                    <Bar key={id} dataKey={techs[id].name} stackId="gen" fill={techs[id as TechType].color} isAnimationActive={false} />
                                ))}
                        </BarChart>
                    ) : (
                        costViewMode === 'waterfall' ? (
                            // Cost Waterfall (System LCOE)
                            <BarChart data={waterfallData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                                <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} label={{ value: 'System LCOE Contribution ($/MWh)', angle: -90, position: 'insideLeft', style: { fill: '#94a3b8' } }} />
                                <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f1f5f9' }} />

                                {/* Capex Segment */}
                                <Bar dataKey="capexRange" name="Capex" stackId="a">
                                    {waterfallData.map((entry, index) => (
                                        <Cell key={`cell-capex-${index}`} fill={entry.color || entry.fill} />
                                    ))}
                                </Bar>

                                {/* Opex Segment (Top of the floating bar) */}
                                <Bar dataKey="opexRange" name="Opex" stackId="a">
                                    {waterfallData.map((entry, index) => (
                                        <Cell key={`cell-opex-${index}`} fill={entry.color || entry.fill} fillOpacity={0.6} stroke={entry.color || entry.fill} strokeWidth={1} />
                                    ))}
                                </Bar>

                                {/* Total Bar */}
                                <Bar dataKey="totalRange" name="Total" stackId="b">
                                    <Cell fill="#0f172a" />
                                </Bar>
                            </BarChart>
                        ) : (
                            // Tech LCOE Stacked Bars
                            <BarChart data={techLcoeData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                                <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} label={{ value: 'Tech LCOE ($/MWh generated)', angle: -90, position: 'insideLeft', style: { fill: '#94a3b8' } }} />
                                <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f1f5f9' }} />
                                <Legend />

                                <Bar dataKey="unitFixed" name="Fixed Cost ($/MWh)" stackId="a" fill="#3b82f6" />
                                <Bar dataKey="unitVar" name="Variable Cost ($/MWh)" stackId="a" fill="#10b981" />
                            </BarChart>
                        )
                    )}
                </ResponsiveContainer>
            </div>
        </div>
    );
};
