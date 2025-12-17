import type { TechType, TechDefinition, SimulationResult } from '../types';

// Use relative URL - works with Vite proxy in dev and same-origin in production
const API_URL = '';

export async function fetchOptimization(
    techs: Record<TechType, TechDefinition>,
    demandProfile: 'spain' | 'baseload' = 'spain',
    region: string = 'es',
    minRenewables: number = 0
): Promise<SimulationResult> {
    const response = await fetch(`${API_URL}/api/optimize`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ techs, demandProfile, region, minRenewables }),
    });

    if (!response.ok) {
        throw new Error(`Optimization failed: ${response.statusText}`);
    }

    return response.json();
}
