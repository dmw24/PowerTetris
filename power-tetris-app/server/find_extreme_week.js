const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const solarPath = path.join(__dirname, '../../renewable profiles/spain/ninja-pv-country-ES-national-merra2.csv');
const windPath = path.join(__dirname, '../../renewable profiles/spain/ninja-wind-country-ES-current_onshore-merra2.csv');
const outputPath = path.join(__dirname, '../public/data/extreme_week_profile.json');

console.log('Reading Solar Data...');
const solarRaw = fs.readFileSync(solarPath, 'utf-8');
// Skip first 3 lines of comments
const solarLines = solarRaw.split('\n').slice(3).join('\n');
const solarData = parse(solarLines, { columns: true, cast: true });

console.log('Reading Wind Data...');
const windRaw = fs.readFileSync(windPath, 'utf-8');
const windLines = windRaw.split('\n').slice(3).join('\n');
const windData = parse(windLines, { columns: true, cast: true });

console.log(`Solar entries: ${solarData.length}, Wind entries: ${windData.length}`);

// Ensure lengths match or take min
const len = Math.min(solarData.length, windData.length);
const HOURS_IN_WEEK = 168;

let minSum = Infinity;
let worstStartIndex = -1;

console.log('Finding worst week...');

// optimization: pre-calculate sums or just iterate
// Solar and Wind factors are 0-1.
// We want lowest combined generation potential.

for (let i = 0; i <= len - HOURS_IN_WEEK; i++) {
    let currentSum = 0;
    // Optimization: We could use a sliding window sum, but loop is fine for < 400k rows
    for (let j = 0; j < HOURS_IN_WEEK; j++) {
        const s = solarData[i + j].NATIONAL || 0;
        const w = windData[i + j].NATIONAL || 0;
        currentSum += (s + w);
    }

    if (currentSum < minSum) {
        minSum = currentSum;
        worstStartIndex = i;
    }
}

console.log('Worst Week Found!');
console.log('Start Index:', worstStartIndex);
console.log('Start Time:', solarData[worstStartIndex].time);
console.log('Min Combined Factor Sum:', minSum);
console.log('Avg Capacity Factor:', minSum / (HOURS_IN_WEEK * 2));

const extremeWeek = [];
for (let j = 0; j < HOURS_IN_WEEK; j++) {
    const idx = worstStartIndex + j;
    extremeWeek.push({
        hour: j,
        time: solarData[idx].time,
        // Using "solar" and "wind" keys to match expected server format
        solar: solarData[idx].NATIONAL || 0,
        wind: windData[idx].NATIONAL || 0
    });
}

fs.writeFileSync(outputPath, JSON.stringify(extremeWeek, null, 2));
console.log(`Saved extreme week profile to ${outputPath}`);
