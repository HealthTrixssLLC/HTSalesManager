import { DynamicsMapper } from './server/dynamics-mapper.js';
import * as fs from 'fs';

async function test() {
  // Load config
  const config = JSON.parse(fs.readFileSync('attached_assets/dynamics_opportunities_mapping_config.json', 'utf8'));

  // Load template
  const template = fs.readFileSync('attached_assets/opportunities-template.csv', 'utf8');

  // Load Excel file
  const excelBuffer = fs.readFileSync('attached_assets/All Opportunities 11-2-2025 4-53-52 PM_1762279846661.xlsx');

  // Create mapper
  const mapper = new DynamicsMapper(config);

  // Read Excel
  const sourceData = mapper.readExcelFile(excelBuffer);
  console.log('Step 1 - Source Data (first row):');
  console.log('  HT Opportunity Number:', sourceData[0]['HT Opportunity Number']);

  // Apply column mapping
  const mapped = mapper.applyColumnMapping(sourceData);
  console.log('\nStep 2 - After Column Mapping (first row):');
  console.log('  opportunityNumber:', mapped[0]['opportunityNumber']);
  console.log('  All mapped keys:', Object.keys(mapped[0]));

  // Test generateRecordId
  const generatedId = mapper.generateRecordId(mapped[0], 0);
  console.log('\nStep 3 - Generated ID:');
  console.log('  Result:', generatedId);
  console.log('  Expected: Opp-1024');
  
  // Check config
  console.log('\nConfig check:');
  console.log('  external_id_fields:', config.id_rules.external_id_fields);
  console.log('  preserve_external_format:', config.id_rules.preserve_external_format);
}

test().catch(console.error);
