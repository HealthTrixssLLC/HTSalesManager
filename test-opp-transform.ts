import { DynamicsMapper } from './server/dynamics-mapper.js';
import * as fs from 'fs';

async function test() {
  // Load config
  const config = JSON.parse(fs.readFileSync('attached_assets/dynamics_opportunities_mapping_config.json', 'utf8'));

  // Load Excel file
  const excelBuffer = fs.readFileSync('attached_assets/All Opportunities 11-2-2025 4-53-52 PM_1762279846661.xlsx');

  // Create mapper
  const mapper = new DynamicsMapper(config);

  // Read the Excel file first to see what columns are there
  const sourceData = mapper.readExcelFile(excelBuffer);
  console.log('=== Total rows:', sourceData.length, '===');
  
  if (sourceData.length > 0) {
    const firstRow = sourceData[0];
    console.log('\n=== Column names in Excel file ===');
    const columns = Object.keys(firstRow);
    columns.forEach((col, i) => console.log(`${i+1}. "${col}"`));
    
    console.log('\n=== Checking for HT Opportunity Number ===');
    console.log('Value:', firstRow['HT Opportunity Number'] || '(not found)');
    
    console.log('\n=== First row data (sample) ===');
    console.log('Topic:', firstRow['Topic']);
    console.log('Status:', firstRow['Status']);
    console.log('Actual Revenue:', firstRow['Actual Revenue']);
  }
}

test().catch(console.error);
