import { DynamicsMapper } from './server/dynamics-mapper.js';
import * as fs from 'fs';

async function test() {
  const config = JSON.parse(fs.readFileSync('attached_assets/dynamics_opportunities_mapping_config.json', 'utf8'));
  const template = fs.readFileSync('attached_assets/opportunities-template.csv', 'utf8');
  const excelBuffer = fs.readFileSync('attached_assets/All Opportunities 11-2-2025 4-53-52 PM_1762279846661.xlsx');
  const mapper = new DynamicsMapper(config);

  // Run full transformation with empty existing accounts
  const result = mapper.transform(excelBuffer, template, []);
  
  console.log('=== Transformation Results ===');
  console.log('Total rows:', result.stats.total_rows);
  console.log('Valid rows:', result.stats.valid_rows);
  console.log('Error rows:', result.stats.error_rows);
  console.log('Duplicate rows:', result.stats.duplicate_rows);
  
  console.log('\n=== First Output Row ===');
  const firstRow = result.data[0];
  console.log('id:', firstRow.id);
  console.log('name:', firstRow.name);
  console.log('accountId:', firstRow.accountId);
  console.log('externalId:', firstRow.externalId);
  console.log('opportunityNumber:', firstRow.opportunityNumber || '(not in output)');
  
  console.log('\n=== All columns in output ===');
  console.log(Object.keys(firstRow).join(', '));
}

test().catch(console.error);
