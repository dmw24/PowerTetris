import React, { useState } from 'react';
import { TechType } from '../types';
import type { TechDefinition } from '../types';
import { ChevronDown, ChevronRight, Settings } from 'lucide-react';

interface SidebarProps {
    techs: Record<TechType, TechDefinition>;
    onChange: (id: TechType, field: keyof TechDefinition, val: number | boolean) => void;
    demandProfile: 'spain' | 'baseload';
    setDemandProfile: (p: 'spain' | 'baseload') => void;
    region: 'es' | 'gb' | 'fr';
    setRegion: (r: 'es' | 'gb' | 'fr') => void;
    minRenewables: number;
    setMinRenewables: (v: number) => void;
    followBnef: boolean;
    onToggleBnef: (v: boolean) => void;
    bnefYear: number;
    setBnefYear: (v: number) => void;
    bnefYears: number[];
}

interface TechCardProps {
    tech: TechDefinition;
    onChange: (field: keyof TechDefinition, val: number | boolean) => void;
}

const TechCard: React.FC<TechCardProps> = ({ tech, onChange }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    return (
        <div className={`rounded-lg border transition-all ${tech.enabled ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50 opacity-60'}`}>
            {/* Header */}
            <div className="flex items-center justify-between p-3">
                <div className="flex items-center gap-2.5">
                    <div className="w-3 h-3 rounded-full shadow-sm" style={{ background: tech.color }} />
                    <span className="text-sm font-semibold text-slate-700">{tech.name}</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className={`text-xs font-mono font-bold ${tech.isFixed ? 'text-slate-400' : 'text-ember-teal'}`}>
                        {(tech.installedCapacity / 1000).toFixed(1)} GW
                        {tech.isFixed && <span className="ml-1 text-[9px] uppercase">FIX</span>}
                    </span>
                    <input
                        type="checkbox"
                        checked={tech.enabled}
                        onChange={(e) => onChange('enabled', e.target.checked)}
                        className="w-4 h-4 rounded border-slate-300 text-ember-teal focus:ring-ember-teal cursor-pointer"
                    />
                </div>
            </div>

            {/* Expand Button */}
            {tech.enabled && (
                <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="w-full flex items-center justify-center gap-1 py-1.5 text-[10px] text-slate-400 hover:text-slate-600 border-t border-slate-100 transition-colors"
                >
                    <Settings size={10} />
                    {isExpanded ? 'Hide' : 'Edit'} Assumptions
                    {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
            )}

            {/* Expanded Controls */}
            {tech.enabled && isExpanded && (
                <div className="p-3 pt-0 space-y-3 border-t border-slate-100">
                    {tech.type === 'storage' ? (
                        // Storage-specific inputs
                        <InputRow label="CAPEX ($/kWh)" value={tech.capexPerKwh || 120} onChange={(v) => onChange('capexPerKwh', v)} min={0} max={500} step={10} />
                    ) : (
                        // Non-storage inputs
                        <InputRow label="CAPEX ($/kW)" value={tech.capex} onChange={(v) => onChange('capex', v)} min={0} max={10000} step={50} />
                    )}
                    <InputRow label="Fixed O&M ($/kW/yr)" value={tech.opexFixed} onChange={(v) => onChange('opexFixed', v)} min={0} max={200} step={5} />
                    <InputRow label="Variable O&M ($/MWh)" value={tech.opexVar} onChange={(v) => onChange('opexVar', v)} min={0} max={50} step={1} />
                    <InputRow label="Fuel Cost ($/MWh)" value={tech.fuelCost} onChange={(v) => onChange('fuelCost', v)} min={0} max={300} step={5} />
                    <InputRow label="Lifetime (years)" value={tech.lifetime} onChange={(v) => onChange('lifetime', v)} min={5} max={60} step={5} />
                    <InputRow label="WACC (%)" value={tech.wacc} onChange={(v) => onChange('wacc', v)} min={1} max={15} step={0.5} />

                    <div className="pt-2 border-t border-slate-100">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Force Capacity</span>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] text-slate-400">
                                    {tech.isFixed ? 'Fixed' : 'Optimized'}
                                </span>
                                <input
                                    type="checkbox"
                                    checked={tech.isFixed || false}
                                    onChange={(e) => onChange('isFixed', e.target.checked)}
                                    className="w-3.5 h-3.5 rounded border-slate-300 text-ember-teal focus:ring-ember-teal cursor-pointer"
                                />
                            </div>
                        </div>

                        {tech.isFixed && (
                            <InputRow
                                label={tech.type === 'storage' ? "Fixed Power (GW)" : "Fixed Capacity (GW)"}
                                value={tech.fixedCapacity || 0}
                                onChange={(v) => onChange('fixedCapacity', v)}
                                min={0}
                                max={800}
                                step={1}
                            />
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

const InputRow: React.FC<{
    label: string;
    value: number;
    onChange: (v: number) => void;
    min: number;
    max: number;
    step: number;
}> = ({ label, value, onChange, min, max, step }) => (
    <div className="space-y-1">
        <div className="flex justify-between">
            <label className="text-[10px] text-slate-500">{label}</label>
            <input
                type="number"
                value={value}
                onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
                className="w-20 text-right text-xs font-mono bg-slate-50 border border-slate-200 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-ember-teal"
                min={min}
                max={max}
                step={step}
            />
        </div>
        <input
            type="range"
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            min={min}
            max={max}
            step={step}
            className="w-full h-1 bg-slate-200 rounded-full appearance-none cursor-pointer accent-ember-teal"
        />
    </div>
);

// Assuming TECH_ORDER is defined elsewhere, e.g.,
const TECH_ORDER: TechType[] = [TechType.SOLAR, TechType.WIND, TechType.WIND_OFFSHORE, TechType.NUCLEAR, TechType.GAS_CCGT, TechType.GAS_OCGT, TechType.COAL, TechType.HYDROGEN, TechType.DIESEL, TechType.BATTERY];

export const Sidebar: React.FC<SidebarProps> = ({
    techs,
    onChange,
    demandProfile,
    setDemandProfile,
    region,
    setRegion,
    minRenewables,
    setMinRenewables,
    followBnef,
    onToggleBnef,
    bnefYear,
    setBnefYear,
    bnefYears
}) => {
    return (
        <aside className="w-80 border-r border-slate-200 bg-slate-50 flex flex-col h-full shadow-sm z-10 shrink-0 overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-slate-200 bg-white sticky top-0 z-20">
                <div className="flex items-center gap-3 mb-1">
                    <div className="bg-gradient-to-br from-ember-teal to-cyan-600 p-2 rounded-lg shadow-sm">
                        <Settings className="text-white" size={20} />
                    </div>
                    <div>
                        <h1 className="font-bold text-slate-800 text-lg leading-tight tracking-tight">Power Tetris</h1>
                        <p className="text-xs font-medium text-slate-500">Grid Optimization Model</p>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto">
                {/* BNEF Trajectory */}
                <div className="p-4 border-b border-slate-200 bg-white space-y-3">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Cost Trajectory</p>
                            <p className="text-xs text-slate-600 leading-snug">Let solar, wind, and storage follow BNEF cost curves.</p>
                        </div>
                        <input
                            type="checkbox"
                            checked={followBnef}
                            onChange={(e) => onToggleBnef(e.target.checked)}
                            className="w-4 h-4 rounded border-slate-300 text-ember-teal focus:ring-ember-teal cursor-pointer mt-0.5"
                        />
                    </div>
                    {followBnef && (
                        <div className="bg-slate-50 border border-slate-100 rounded-lg p-3">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">BNEF Year</span>
                                <span className="text-xs font-semibold text-ember-teal">{bnefYear}</span>
                            </div>
                            {(() => {
                                const idx = Math.max(0, bnefYears.indexOf(bnefYear));
                                return (
                                    <>
                                        <input
                                            type="range"
                                            min={0}
                                            max={bnefYears.length - 1}
                                            step={1}
                                            value={idx}
                                            onChange={(e) => setBnefYear(bnefYears[parseInt(e.target.value)])}
                                            className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-ember-teal"
                                        />
                                        <div className="flex flex-wrap gap-2 mt-2 text-[10px] text-slate-500">
                                            {bnefYears.map(year => (
                                                <button
                                                    key={year}
                                                    onClick={() => setBnefYear(year)}
                                                    className={`px-2 py-0.5 rounded border text-[10px] transition-colors ${year === bnefYear ? 'border-ember-teal text-ember-teal bg-white' : 'border-slate-200 text-slate-500 hover:text-slate-700 bg-slate-100'}`}
                                                >
                                                    {year}
                                                </button>
                                            ))}
                                        </div>
                                    </>
                                );
                            })()}
                        </div>
                    )}
                </div>

                {/* Global Settings */}
                <div className="p-4 border-b border-slate-200 bg-white space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Region</label>
                            <div className="relative">
                                <select
                                    value={region}
                                    onChange={(e) => setRegion(e.target.value as any)}
                                    className="w-full text-xs font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 appearance-none focus:ring-2 focus:ring-ember-teal focus:border-transparent outline-none transition-all cursor-pointer hover:bg-slate-100"
                                >
                                    <option value="es">🇪🇸 Spain</option>
                                    <option value="gb">🇬🇧 UK</option>
                                    <option value="fr">🇫🇷 France</option>
                                </select>
                                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={12} />
                            </div>
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Profile</label>
                            <div className="relative">
                                <select
                                    value={demandProfile}
                                    onChange={(e) => setDemandProfile(e.target.value as any)}
                                    className="w-full text-xs font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 appearance-none focus:ring-2 focus:ring-ember-teal focus:border-transparent outline-none transition-all cursor-pointer hover:bg-slate-100"
                                >
                                    <option value="spain">Seasonal</option>
                                    <option value="baseload">Flat</option>
                                </select>
                                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={12} />
                            </div>
                        </div>
                    </div>

                    {/* Min Renewables Slider */}
                    <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Min Renewables</label>
                            <span className="text-xs font-bold text-ember-teal bg-white px-2 py-0.5 rounded shadow-sm border border-slate-100">{minRenewables}%</span>
                        </div>
                        {(() => {
                            const steps = [0, 10, 20, 30, 40, 50, 60, 70, 80, 85, 90, 95, 97, 99, 99.9];
                            const currentIndex = steps.findIndex(s => s === minRenewables) !== -1
                                ? steps.findIndex(s => s === minRenewables)
                                : steps.reduce((prev, curr, i) => Math.abs(curr - minRenewables) < Math.abs(steps[prev] - minRenewables) ? i : prev, 0);

                            return (
                                <input
                                    type="range"
                                    min="0"
                                    max={steps.length - 1}
                                    step="1"
                                    value={currentIndex}
                                    onChange={(e) => setMinRenewables(steps[parseInt(e.target.value)])}
                                    className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-ember-teal"
                                />
                            );
                        })()}
                        <div className="flex justify-between text-[9px] font-medium text-slate-400 mt-1 uppercase tracking-wider">
                            <span>Economic</span>
                            <span>Forced</span>
                        </div>
                    </div>
                </div>

                {/* Tech List */}
                <div className="p-4 space-y-3 custom-scrollbar">
                    <div className="flex items-center justify-between mb-2">
                        <h2 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Technologies</h2>
                        <span className="text-[10px] font-semibold text-slate-400">{Object.keys(techs).length} Available</span>
                    </div>
                    {TECH_ORDER.map(id => (
                        <TechCard
                            key={id}
                            tech={techs[id]}
                            onChange={(field, val) => onChange(id, field, val)}
                        />
                    ))}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-200 bg-slate-50 text-[10px] text-slate-400 text-center">
                    Power Tetris v0.4
                </div>
            </div>
        </aside>
    );
};
