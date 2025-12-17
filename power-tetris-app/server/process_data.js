const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const COUNTRIES = [
    { code: 'es', folder: 'spain', pv: 'ninja-pv-country-ES-national-merra2.csv', wind: 'ninja-wind-country-ES-current_onshore-merra2.csv', offshore: null },
    { code: 'gb', folder: 'united kingdom', pv: 'ninja-pv-country-GB-national-merra2.csv', wind: 'ninja-wind-country-GB-current_onshore-merra2.csv', offshore: 'ninja-wind-country-GB-current_offshore-merra2.csv' },
    { code: 'fr', folder: 'france', pv: 'ninja-pv-country-FR-national-merra2.csv', wind: 'ninja-wind-country-FR-current_onshore-merra2.csv', offshore: null }
];

const RAW_DIR = path.join(__dirname, '../../renewable profiles');
const OUT_DIR = path.join(__dirname, '../public/data');
const HOURS_IN_WEEK = 168;

function processCountry(country) {
    console.log(`Processing ${country.code.toUpperCase()}...`);
    const solarPath = path.join(RAW_DIR, country.folder, country.pv);
    const windPath = path.join(RAW_DIR, country.folder, country.wind);

    // Check paths
    if (!fs.existsSync(solarPath)) { console.error(`Missing ${solarPath} `); return; }
    if (!fs.existsSync(windPath)) { console.error(`Missing ${windPath} `); return; }

    const solarRaw = fs.readFileSync(solarPath, 'utf-8');
    const solarLines = solarRaw.split('\n').slice(3).join('\n'); // Skip 3 header lines
    const solarData = parse(solarLines, { columns: true, cast: true });

    const windRaw = fs.readFileSync(windPath, 'utf-8');
    const windLines = windRaw.split('\n').slice(3).join('\n');
    const windData = parse(windLines, { columns: true, cast: true });

    let offshoreData = null;
    if (country.offshore) {
        const offshorePath = path.join(RAW_DIR, country.folder, country.offshore);
        if (fs.existsSync(offshorePath)) {
            const raw = fs.readFileSync(offshorePath, 'utf-8');
            const lines = raw.split('\n').slice(3).join('\n');
            offshoreData = parse(lines, { columns: true, cast: true });
        } else {
            console.warn(`  Warning: Offshore file not found for ${country.code}: ${offshorePath}. Will use zero values.`);
        }
    }

    // 1. Extract 2019 Data
    console.log('  Extracting 2019 data...');
    const solar2019 = [];
    const wind2019 = [];
    const offshore2019 = [];

    // Filter by year 2019
    for (let i = 0; i < solarData.length; i++) {
        const row = solarData[i];
        if (row.time.startsWith('2019')) {
            solar2019.push({ time: row.time, factor: row.NATIONAL });
            // Assume wind matches index/time (Merra2 usually aligned)
            wind2019.push({ time: row.time, factor: windData[i]?.NATIONAL || 0 });

            if (offshoreData) {
                offshore2019.push({ time: row.time, factor: offshoreData[i]?.NATIONAL || 0 });
            } else {
                offshore2019.push({ time: row.time, factor: 0 }); // Zero if no offshore
            }
        }
    }

    const csvHeader = 'time,factor\n';
    const solarCsv = csvHeader + solar2019.map(r => `${r.time},${r.factor} `).join('\n');
    const windCsv = csvHeader + wind2019.map(r => `${r.time},${r.factor} `).join('\n');
    const offshoreCsv = csvHeader + offshore2019.map(r => `${r.time},${r.factor} `).join('\n');

    fs.writeFileSync(path.join(OUT_DIR, `${country.code}_solar_2019.csv`), solarCsv);
    fs.writeFileSync(path.join(OUT_DIR, `${country.code}_wind_2019.csv`), windCsv);
    fs.writeFileSync(path.join(OUT_DIR, `${country.code}_offshore_2019.csv`), offshoreCsv);


    // 2. Find Extreme Week (Worst 168h in entire dataset)
    console.log('  Finding worst week (1980-2024)...');
    const len = Math.min(solarData.length, windData.length, offshoreData ? offshoreData.length : Infinity);
    let minSum = Infinity;
    let worstStartIndex = -1;

    for (let i = 0; i <= len - HOURS_IN_WEEK; i++) {
        let currentSum = 0;
        for (let j = 0; j < HOURS_IN_WEEK; j++) {
            const s = solarData[i + j].NATIONAL || 0;
            const w = windData[i + j].NATIONAL || 0;
            const o = offshoreData ? (offshoreData[i + j]?.NATIONAL || 0) : 0;
            currentSum += (s + w + o);
        }

        if (currentSum < minSum) {
            minSum = currentSum;
            worstStartIndex = i;
        }
    }

    const extremeWeek = [];
    for (let j = 0; j < HOURS_IN_WEEK; j++) {
        const idx = worstStartIndex + j;
        extremeWeek.push({
            hour: j,
            time: solarData[idx].time,
            solar: solarData[idx].NATIONAL || 0,
            wind: windData[idx].NATIONAL || 0,
            offshore: offshoreData ? (offshoreData[idx]?.NATIONAL || 0) : 0
        });
    }

    fs.writeFileSync(path.join(OUT_DIR, `${country.code}_extreme_week.json`), JSON.stringify(extremeWeek, null, 2));
    console.log(`  Done.Worst week: ${extremeWeek[0].time} `);
}

COUNTRIES.forEach(c => processCountry(c));

console.log('All countries processed.');
