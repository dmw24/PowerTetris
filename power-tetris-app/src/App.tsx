import React, { useState, useEffect, useMemo } from 'react';
import { Sidebar } from './components/Sidebar';
import { Charts } from './components/Charts';
import { DEFAULT_TECHS, REPRESENTATIVE_WEEKS, BNEF_PROJECTIONS, BNEF_YEARS } from './constants';
import { TechType } from './types';
import type { TechDefinition, SimulationResult, RepresentativeWeek } from './types';
import { fetchOptimization } from './utils/api';
import { Loader2 } from 'lucide-react';

const App: React.FC = () => {
  const [weekConfigs, setWeekConfigs] = useState<Record<string, RepresentativeWeek[]>>({});
  const [techs, setTechs] = useState<Record<TechType, TechDefinition>>(DEFAULT_TECHS);
  const [manualTechs, setManualTechs] = useState<Record<TechType, TechDefinition> | null>(null);
  const [followBnef, setFollowBnef] = useState(false);
  const [bnefYear, setBnefYear] = useState<number>(BNEF_YEARS[0]);
  const [weekIndex, setWeekIndex] = useState(0); // Initialize with 0, update when weeks load
  const [demandProfile, setDemandProfile] = useState<'spain' | 'baseload'>('spain');
  const [region, setRegion] = useState<'es' | 'gb' | 'fr'>('es');
  const [minRenewables, setMinRenewables] = useState(0); // % 0-100

  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Run Optimization when techs, demand profile or region change (debounced)
  useEffect(() => {
    const timer = setTimeout(async () => {
      setIsSimulating(true);
      setError(null);

      try {
        const result = await fetchOptimization(techs, demandProfile, region, minRenewables);
        setSimulationResult(result);
      } catch (e) {
        console.error("Optimization error:", e);
        setError(e instanceof Error ? e.message : 'Optimization failed');
      } finally {
        setIsSimulating(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [techs, demandProfile, region, minRenewables]);

  // Load Weeks Config
  useEffect(() => {
    fetch('/api/weeks')
      .then(res => res.json())
      .then(data => {
        setWeekConfigs(data);
        // Set initial week index for default region if not set
        if (data['es'] && data['es'].length > 0) {
          setWeekIndex(data['es'][0].startHour);
        }
      })
      .catch(err => console.error("Failed to load weeks:", err));
  }, []);

  const currentWeeks = useMemo(() => {
    return weekConfigs[region] || weekConfigs['es'] || REPRESENTATIVE_WEEKS;
  }, [weekConfigs, region]);

  // Reset week index if region changes and current week is not in new list
  useEffect(() => {
    if (currentWeeks.length > 0) {
      const found = currentWeeks.find(w => w.startHour === weekIndex);
      if (!found) {
        setWeekIndex(currentWeeks[0].startHour);
      }
    }
  }, [region, currentWeeks]);

  const handleTechChange = (id: TechType, field: keyof TechDefinition, val: number | boolean) => {
    setTechs(prev => ({
      ...prev,
      [id]: { ...prev[id], [field]: val }
    }));
  };

  // Apply BNEF trajectory when enabled or when year changes
  useEffect(() => {
    if (!followBnef) return;
    const projection = BNEF_PROJECTIONS[bnefYear];
    if (!projection) return;

    setTechs(prev => {
      const batteryDuration = prev[TechType.BATTERY].duration || 4;
      return {
        ...prev,
        [TechType.SOLAR]: {
          ...prev[TechType.SOLAR],
          capex: projection.solar.capex,
          opexFixed: projection.solar.opexFixed,
        },
        [TechType.WIND]: {
          ...prev[TechType.WIND],
          capex: projection.wind.capex,
          opexFixed: projection.wind.opexFixed,
        },
        [TechType.BATTERY]: {
          ...prev[TechType.BATTERY],
          capexPerKwh: projection.battery.capexPerKwh,
          capex: projection.battery.capexPerKwh * batteryDuration,
          opexFixed: projection.battery.opexFixed,
        }
      };
    });
  }, [followBnef, bnefYear]);

  const handleToggleBnef = (enabled: boolean) => {
    if (enabled) {
      setManualTechs(techs);
      setFollowBnef(true);
    } else {
      setFollowBnef(false);
      if (manualTechs) {
        setTechs(manualTechs);
        setManualTechs(null);
      }
    }
  };

  const displayTechs = useMemo(() => {
    const merged = { ...techs };
    if (simulationResult) {
      Object.keys(simulationResult.capacities).forEach(key => {
        const id = key as TechType;
        if (merged[id]) {
          merged[id] = { ...merged[id], installedCapacity: simulationResult.capacities[id] };
        }
      });
    }
    return merged;
  }, [techs, simulationResult]);

  return (
    <div className="flex bg-slate-100 h-screen w-full overflow-hidden font-sans text-slate-900">
      <Sidebar
        techs={displayTechs}
        onChange={handleTechChange}
        demandProfile={demandProfile}
        setDemandProfile={setDemandProfile}
        region={region}
        setRegion={setRegion}
        minRenewables={minRenewables}
        setMinRenewables={setMinRenewables}
        followBnef={followBnef}
        onToggleBnef={handleToggleBnef}
        bnefYear={bnefYear}
        setBnefYear={setBnefYear}
        bnefYears={BNEF_YEARS}
      />

      <main className="flex-1 flex flex-col min-w-0 relative">
        {error && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-red-50 text-red-700 px-4 py-2 rounded-lg border border-red-200 shadow-lg z-50 text-sm">
            {error}
          </div>
        )}

        {simulationResult && (
          <div className="flex-1 min-h-0">
            <Charts
              result={simulationResult}
              techs={displayTechs}
              weekIndex={weekIndex}
              setWeekIndex={setWeekIndex}
              weeks={currentWeeks}
            />
          </div>
        )}

        {!simulationResult && !error && (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="animate-spin text-ember-teal" size={32} />
              <span className="text-sm font-medium text-slate-500">Running optimization...</span>
            </div>
          </div>
        )}

        {isSimulating && simulationResult && (
          <div className="absolute top-4 right-4 bg-white/90 backdrop-blur px-3 py-1.5 rounded-full shadow-lg border border-slate-100 flex items-center gap-2 text-xs font-medium text-slate-500 z-50">
            <Loader2 className="animate-spin" size={12} />
            Optimizing...
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
