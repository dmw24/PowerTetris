import { TechType } from './types';
import type { TechDefinition } from './types';

// We use 168 hours for the solver window to keep performance high
export const HOURS_IN_WEEK = 168;

// High-level BNEF-style cost trajectory assumptions (2025-2050)
// Costs are in $/kW for generation and $/kWh for storage capex.
export const BNEF_PROJECTIONS: Record<number, {
    solar: { capex: number; opexFixed: number };
    wind: { capex: number; opexFixed: number };
    battery: { capexPerKwh: number; opexFixed: number };
}> = {
    2025: {
        solar: { capex: 850, opexFixed: 10 },
        wind: { capex: 1400, opexFixed: 35 },
        battery: { capexPerKwh: 120, opexFixed: 10 },
    },
    2030: {
        solar: { capex: 650, opexFixed: 9 },
        wind: { capex: 1150, opexFixed: 32 },
        battery: { capexPerKwh: 90, opexFixed: 8 },
    },
    2035: {
        solar: { capex: 550, opexFixed: 8 },
        wind: { capex: 1000, opexFixed: 29 },
        battery: { capexPerKwh: 70, opexFixed: 6 },
    },
    2040: {
        solar: { capex: 500, opexFixed: 7 },
        wind: { capex: 900, opexFixed: 26 },
        battery: { capexPerKwh: 55, opexFixed: 5 },
    },
    2045: {
        solar: { capex: 450, opexFixed: 6 },
        wind: { capex: 820, opexFixed: 24 },
        battery: { capexPerKwh: 45, opexFixed: 4 },
    },
    2050: {
        solar: { capex: 400, opexFixed: 6 },
        wind: { capex: 780, opexFixed: 22 },
        battery: { capexPerKwh: 35, opexFixed: 3 },
    },
};

export const BNEF_YEARS = Object.keys(BNEF_PROJECTIONS).map(y => parseInt(y, 10)).sort((a, b) => a - b);

export const REPRESENTATIVE_WEEKS = [
    { startHour: 3528, label: 'Summer (High Solar)' },
    { startHour: 672, label: 'Winter (High Wind)' },
    { startHour: 5712, label: 'Late Summer (Low Renewables)' },
    { startHour: 8591, label: 'Extreme (Worst in 2019)' },
    { startHour: -1, label: 'Extreme (Worst since 1980)' }
];

export const DEFAULT_TECHS: Record<TechType, TechDefinition> = {
    [TechType.SOLAR]: {
        id: TechType.SOLAR,
        name: 'Solar PV',
        color: '#FDB813',
        type: 'renewable',
        capex: 850,
        opexFixed: 10,
        opexVar: 0,
        fuelCost: 0,
        lifetime: 30,
        wacc: 6,
        co2: 0,
        enabled: true,
        installedCapacity: 0,
        isFixed: false,
        fixedCapacity: 0,
    },
    [TechType.WIND]: {
        id: TechType.WIND,
        name: 'Onshore Wind',
        color: '#00A4E4',
        type: 'renewable',
        capex: 1400,
        opexFixed: 35,
        opexVar: 0,
        fuelCost: 0,
        lifetime: 25,
        wacc: 6,
        co2: 0,
        enabled: true,
        installedCapacity: 0,
    },
    [TechType.WIND_OFFSHORE]: {
        id: TechType.WIND_OFFSHORE,
        name: 'Offshore Wind',
        type: 'renewable',
        color: '#0891b2', // Teal/Cyan
        capex: 3200,
        opexFixed: 80,
        opexVar: 3,
        lifetime: 25,
        wacc: 7,
        co2: 0,
        fuelCost: 0,
        enabled: false,
        installedCapacity: 0
    },
    [TechType.BATTERY]: {
        id: TechType.BATTERY,
        name: 'Li-Ion Battery',
        color: '#33C481',
        type: 'storage',
        capexPerKwh: 120, // $/kWh
        duration: 4, // hours (user can adjust)
        capex: 480, // Derived: 120 * 4 = 480 $/kW
        opexFixed: 10,
        opexVar: 1,
        fuelCost: 0,
        lifetime: 20,
        wacc: 5,
        co2: 0,
        enabled: true,
        installedCapacity: 0,
    },
    [TechType.NUCLEAR]: {
        id: TechType.NUCLEAR,
        name: 'Nuclear',
        color: '#E040FB',
        type: 'dispatchable',
        capex: 8500,
        opexFixed: 125,
        opexVar: 2,
        fuelCost: 8,
        lifetime: 40,
        wacc: 7,
        co2: 0,
        enabled: true,
        installedCapacity: 0,
    },
    [TechType.COAL]: {
        id: TechType.COAL,
        name: 'Coal',
        color: '#374151',
        type: 'dispatchable',
        capex: 3500,
        opexFixed: 40,
        opexVar: 5,
        fuelCost: 25,
        lifetime: 30,
        wacc: 10,
        co2: 950,
        enabled: true,
        installedCapacity: 0,
    },
    [TechType.GAS_CCGT]: {
        id: TechType.GAS_CCGT,
        name: 'Gas CCGT',
        color: '#F4511E',
        type: 'dispatchable',
        capex: 2000,
        opexFixed: 30,
        opexVar: 6,
        fuelCost: 50,
        lifetime: 20,
        wacc: 10,
        co2: 350,
        enabled: true,
        installedCapacity: 0,
    },
    [TechType.GAS_OCGT]: {
        id: TechType.GAS_OCGT,
        name: 'Gas OCGT (Peaker)',
        color: '#8D6E63',
        type: 'dispatchable',
        capex: 800,
        opexFixed: 20,
        opexVar: 10,
        fuelCost: 68.3,
        lifetime: 20,
        wacc: 10,
        co2: 500,
        enabled: true,
        installedCapacity: 0,
    },
    [TechType.HYDROGEN]: {
        id: TechType.HYDROGEN,
        name: 'Hydrogen Peaker',
        color: '#60A5FA',
        type: 'dispatchable',
        capex: 1000,
        opexFixed: 25,
        opexVar: 8,
        fuelCost: 200,
        lifetime: 20,
        wacc: 8,
        co2: 0,
        enabled: true,
        installedCapacity: 0,
    },
    [TechType.DIESEL]: {
        id: TechType.DIESEL,
        name: 'Diesel Gen',
        color: '#546E7A',
        type: 'dispatchable',
        capex: 350,
        opexFixed: 10,
        opexVar: 15,
        fuelCost: 150,
        lifetime: 20,
        wacc: 10,
        co2: 700,
        enabled: true,
        installedCapacity: 0,
    },
};
