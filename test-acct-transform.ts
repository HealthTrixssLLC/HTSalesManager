import { DynamicsMapper } from './server/dynamics-mapper.js';
import * as fs from 'fs';

async function test() {
  const config = JSON.parse(fs.readFileSync('attached_assets/dynamics_mapping_config.json', 'utf8'));
  const template = fs.readFileSync('attached_assets/accounts-template.csv', 'utf8');
  const excelBuffer = fs.readFileSync('attached_assets/Active Accounts 11-2-2025 10-03-45 AM_1762099944282.xlsx');
  const mapper = new DynamicsMapper(config);

  // Read source data
  const sourceData = mapper.readExcelFile(excelBuffer);
  console.log('=== Source Data (first row) ===');
  console.log('Account Name:', sourceData[0]['Account Name']);
  console.log('HT Account Number:', sourceData[0]['HT Account Number']);

  // Run full transformation
  const result = mapper.transform(excelBuffer, template, []);
  
  console.log('\n=== Transformation Results ===');
  console.log('Total rows:', result.stats.total_rows);
  console.log('Valid rows:', result.stats.valid_rows);
  
  console.log('\n=== First 3 Output Rows ===');
  for (let i = 0; i < Math.min(3, result.data.length); i++) {
    const row = result.data[i];
    console.log(`${i+1}. id: "${row.id}", name: "${row.name}", accountNumber: "${row.accountNumber || '(not in output)'}"`);
  }
}

test().catch(console.error);
