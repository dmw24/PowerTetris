export enum TechType {
    SOLAR = 'SOLAR',
    WIND = 'WIND',
    WIND_OFFSHORE = 'WIND_OFFSHORE',
    BATTERY = 'BATTERY',
    NUCLEAR = 'NUCLEAR',
    COAL = 'COAL',
    GAS_CCGT = 'GAS_CCGT',
    GAS_OCGT = 'GAS_OCGT',
    HYDROGEN = 'HYDROGEN',
    DIESEL = 'DIESEL'
}

export interface TechDefinition {
    id: TechType;
    name: string;
    color: string;
    type: 'renewable' | 'storage' | 'baseload' | 'dispatchable';
    // Economic Assumptions
    capex: number; // $/kW (for non-storage) or derived from capexPerKwh * duration
    capexPerKwh?: number; // $/kWh (for storage only)
    duration?: number; // hours (for storage only)
    opexFixed: number; // $/kW/year
    opexVar: number; // $/MWh
    fuelCost: number; // $/MWh equivalent
    lifetime: number; // years
    wacc: number; // % (0-100)
    co2: number; // kg/MWh

    // Optimization State
    enabled: boolean;
    installedCapacity: number; // MW (Proposed/Fixed)
    isFixed?: boolean;
    fixedCapacity?: number; // GW
}

export interface HourlyData {
    time?: string;
    hour: number;
    demand: number; // MW
    solar: number; // Normalized 0-1
    wind: number; // Normalized 0-1

    // Calculated results
    solarGen?: number;
    windGen?: number;
    offshoreGen?: number;
    nuclearGen?: number;
    coalGen?: number;
    gasCcgtGen?: number;
    gasOcgtGen?: number;
    hydrogenGen?: number;
    dieselGen?: number;
    curtailment?: number;
    batteryDischarge?: number;
    batteryCharge?: number;
    shortfall?: number;
    batterySoC?: number; // MWh
}

// Optimization Result Interface
export interface RepresentativeWeek {
    startHour: number;
    label: string;
    weight?: number;
}

export interface SimulationResult {
    hourly: HourlyData[];
    totalCost: number; // $ for the week
    lcoe: number; // $/MWh
    totalCo2: number; // Tonnes
    mix: { [key in TechType]: number }; // Total MWh per tech
    capacities: { [key in TechType]: number }; // Optimized MW
    unservedEnergy: number; // MWh
    annualServed?: number; // MWh (Weighted annual)
}
