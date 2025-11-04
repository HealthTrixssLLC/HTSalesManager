const { DynamicsMapper } = require('./server/dynamics-mapper.ts');
const fs = require('fs');

// Load config
const config = JSON.parse(fs.readFileSync('attached_assets/dynamics_opportunities_mapping_config.json', 'utf8'));

// Load template
const template = fs.readFileSync('attached_assets/opportunities-template.csv', 'utf8');

// Load Excel file
const excelBuffer = fs.readFileSync('attached_assets/All Opportunities 11-2-2025 4-53-52 PM_1762279846661.xlsx');

// Create mapper
const mapper = new DynamicsMapper(config);

// Read the Excel file first to see what columns are there
const sourceData = mapper.readExcelFile(excelBuffer);
console.log('=== First 2 rows of source data ===');
console.log(JSON.stringify(sourceData.slice(0, 2), null, 2));

// Check if HT Opportunity Number exists
if (sourceData.length > 0) {
  const firstRow = sourceData[0];
  console.log('\n=== Checking for HT Opportunity Number column ===');
  console.log('Columns in source:', Object.keys(firstRow));
  console.log('HT Opportunity Number value:', firstRow['HT Opportunity Number']);
}
