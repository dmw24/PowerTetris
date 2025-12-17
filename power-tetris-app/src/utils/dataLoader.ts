import Papa from 'papaparse';
import type { HourlyData } from '../types';

export const loadSpainData = async (): Promise<HourlyData[]> => {
    try {
        const [solarRes, windRes] = await Promise.all([
            fetch('./data/solar_2019.csv').then(r => r.text()),
            fetch('./data/wind_2019.csv').then(r => r.text())
        ]);

        const parseOptions = { header: true, dynamicTyping: true, skipEmptyLines: true };
        const solarData = Papa.parse(solarRes, parseOptions).data as any[];
        const windData = Papa.parse(windRes, parseOptions).data as any[];

        console.log("Loaded Data Rows:", solarData.length);

        if (!solarData.length || !windData.length) {
            throw new Error("Empty CSV data");
        }

        // Default Demand for Spain (Scaled ~30GW)
        // We'll create a synthetic demand based on time of day/year
        const combined: HourlyData[] = solarData.map((sRow, i) => {
            const wRow = windData[i] || {};
            const dateStr = sRow.time;
            const date = new Date(dateStr || Date.now());
            const hour = date.getHours();
            const month = date.getMonth(); // 0-11

            // Seasonal patterns
            let seasonFactor = 1.0;
            if (month < 2 || month > 10) seasonFactor = 1.1; // Winter Heat
            if (month > 5 && month < 8) seasonFactor = 1.15; // Summer AC

            // Daily patterns
            let dailyFactor = 0.8;
            if (hour >= 7 && hour < 23) dailyFactor = 1.0;
            if (hour >= 20 && hour < 22) dailyFactor = 1.1; // Peak
            if (hour >= 13 && hour < 16) dailyFactor = 1.05; // Day

            const baseDemand = 30000; // 30GW
            const demand = baseDemand * seasonFactor * dailyFactor * (0.95 + Math.random() * 0.1);

            return {
                hour: i, // Index
                time: dateStr,
                demand: Math.round(demand),
                solar: sRow.factor || 0,
                wind: wRow.factor || 0
            };
        });

        return combined;
    } catch (e) {
        console.error("Failed to load data", e);
        return [];
    }
};

export const getWeekData = (fullData: HourlyData[], startHour: number = 0): HourlyData[] => {
    // Return 168 hours starting from startHour
    // Handle wrap around? No, just slice.
    return fullData.slice(startHour, startHour + 168);
}
