// Database seeding script to initialize roles and permissions
// Run this script to populate the database with default data

import { db } from "./db";
import { roles, permissions, rolePermissions, users, userRoles, organizations, userOrganizations } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { hashPassword } from "./auth";

/**
 * Startup column migration — runs BEFORE any ORM queries.
 *
 * Production databases that were deployed before the multi-tenant schema was
 * applied will be missing the `organization_id` column on many tables and
 * the `organizations` / `user_organizations` tables entirely.
 *
 * All statements use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS so they are
 * fully idempotent — safe to run on every server start with zero cost once
 * the columns already exist.
 */
export async function runStartupColumnMigration(): Promise<void> {
  try {
    // 1. Create the organizations table if it doesn't exist yet
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS organizations (
        id VARCHAR(50) PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(100) NOT NULL,
        description TEXT,
        settings JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `));

    // Unique index on slug (separate from table creation for IF NOT EXISTS safety)
    await db.execute(sql.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS organizations_slug_idx ON organizations (slug)
    `));

    // 2. Create the user_organizations join table if it doesn't exist yet
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS user_organizations (
        id VARCHAR(50) PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
        user_id VARCHAR(50) NOT NULL,
        organization_id VARCHAR(50) NOT NULL,
        role_id VARCHAR(50) NOT NULL,
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `));

    await db.execute(sql.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS user_organizations_unique_idx
        ON user_organizations (user_id, organization_id)
    `));

    // 3. Add organization_id column (nullable VARCHAR) to every table that
    //    references it in the Drizzle schema. No FK constraint here — that is
    //    applied later by drizzle-kit push once data is backfilled.
    const tables = [
      'accounts',
      'contacts',
      'leads',
      'opportunities',
      'activities',
      'icp_profiles',
      'task_playbooks',
      'lead_generation_runs',
      'id_patterns',
      'account_categories',
      'api_keys',
      'llm_configurations',
    ];

    for (const table of tables) {
      await db.execute(sql.raw(
        `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS organization_id VARCHAR(50)`
      ));
    }

    // 4. Add any extra columns to the organizations table that may have been
    //    added after the initial table creation
    await db.execute(sql.raw(`
      ALTER TABLE organizations ADD COLUMN IF NOT EXISTS logo_url TEXT
    `));

    // 5. Add billing_end_date to opportunities (added in v2.1.1)
    await db.execute(sql.raw(`
      ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS billing_end_date TIMESTAMP
    `));

    // 5b. Ensure lead_generation_runs.organization_id has its FK constraint.
    //     ADD COLUMN IF NOT EXISTS won't add the FK if the column already exists,
    //     so we add the constraint separately using a DO block (idempotent).
    await db.execute(sql.raw(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_schema = 'public'
            AND table_name        = 'lead_generation_runs'
            AND constraint_name   = 'lead_generation_runs_organization_id_fk'
            AND constraint_type   = 'FOREIGN KEY'
        ) THEN
          -- Only add if the column actually exists (it may have been added above)
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name   = 'lead_generation_runs'
              AND column_name  = 'organization_id'
          ) THEN
            ALTER TABLE lead_generation_runs
              ADD CONSTRAINT lead_generation_runs_organization_id_fk
              FOREIGN KEY (organization_id)
              REFERENCES organizations(id)
              ON DELETE CASCADE;
          END IF;
        END IF;
      END $$;
    `));

    // 6. Create ai_configs table if it doesn't exist yet (added in Lead Gen module)
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS ai_configs (
        id VARCHAR(50) PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
        name TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        api_key_env_var TEXT,
        base_url TEXT,
        temperature DECIMAL(3,2) DEFAULT 0.7,
        max_tokens INTEGER DEFAULT 4096,
        agent_phase TEXT,
        is_default BOOLEAN NOT NULL DEFAULT false,
        is_active BOOLEAN NOT NULL DEFAULT true,
        metadata JSONB DEFAULT '{}',
        created_by VARCHAR(50),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `));

    // 7. Create crm_documents table if it doesn't exist yet (added in Research Docs module)
    //    entity_type stored as TEXT here; drizzle-kit push will enforce the enum constraint.
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS crm_documents (
        id VARCHAR(50) PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
        entity_type TEXT NOT NULL,
        entity_id VARCHAR(100) NOT NULL,
        file_name TEXT NOT NULL,
        file_path TEXT,
        file_data TEXT,
        content_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        uploaded_by VARCHAR(50) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `));

    // 7a. Ensure api_keys.permissions exists (Phase F scopes). Auth reads this
    //     column on every external request, so deployments upgrading from a
    //     pre-Phase-F database must get it here. Default = all scopes (legacy keys keep access).
    await db.execute(sql.raw(`
      ALTER TABLE api_keys
        ADD COLUMN IF NOT EXISTS permissions text[]
        DEFAULT ARRAY['crm.read','crm.write','activities.read','activities.write','documents.read','documents.write']::text[]
    `));

    // 7b. Create documents + document_links tables (Phase D document references).
    //     Mirrors migrations/0013_add_documents.sql; fully idempotent for deployments.
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS documents (
        id VARCHAR(100) PRIMARY KEY,
        organization_id VARCHAR(50) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        document_type TEXT,
        source_system TEXT,
        canonical_url TEXT NOT NULL,
        version TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        mime_type TEXT,
        external_id TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS documents_org_id_idx ON documents (organization_id)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS documents_external_id_idx ON documents (external_id)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS documents_updated_at_idx ON documents (updated_at)`));
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS document_links (
        id VARCHAR(50) PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
        document_id VARCHAR(100) NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        entity_type TEXT NOT NULL,
        entity_id VARCHAR(100) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS document_links_document_id_idx ON document_links (document_id)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS document_links_entity_idx ON document_links (entity_type, entity_id)`));
    await db.execute(sql.raw(`CREATE UNIQUE INDEX IF NOT EXISTS document_links_unique_idx ON document_links (document_id, entity_type, entity_id)`));

    // 8. Add 'lead_generation' to the lead_source enum if not already present.
    //    ALTER TYPE ... ADD VALUE IF NOT EXISTS is idempotent and safe on existing DBs.
    await db.execute(sql.raw(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum e
          JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = 'lead_source' AND e.enumlabel = 'lead_generation'
        ) THEN
          ALTER TYPE lead_source ADD VALUE 'lead_generation';
        END IF;
      END $$;
    `));

    console.log('✓ Startup column migration completed');
  } catch (error) {
    console.error('Startup column migration error (non-fatal):', error);
    // Non-fatal: allow startup to continue; subsequent errors will surface naturally
  }
}

type RoleConfig = {
  name: string;
  description: string;
  permissions: { resource: string; action: string }[];
};

const defaultRoles: RoleConfig[] = [
  {
    name: "Admin",
    description: "Full system access including user/role management and system operations",
    permissions: [
      { resource: "*", action: "*" }, // Admin has all permissions
    ],
  },
  {
    name: "SalesManager",
    description: "Manage all CRM entities, view reports, assign leads to team",
    permissions: [
      { resource: "Account", action: "read" },
      { resource: "Account", action: "create" },
      { resource: "Account", action: "update" },
      { resource: "Account", action: "delete" },
      { resource: "Contact", action: "read" },
      { resource: "Contact", action: "create" },
      { resource: "Contact", action: "update" },
      { resource: "Contact", action: "delete" },
      { resource: "Lead", action: "read" },
      { resource: "Lead", action: "create" },
      { resource: "Lead", action: "update" },
      { resource: "Lead", action: "delete" },
      { resource: "Lead", action: "convert" },
      { resource: "Opportunity", action: "read" },
      { resource: "Opportunity", action: "create" },
      { resource: "Opportunity", action: "update" },
      { resource: "Opportunity", action: "delete" },
      { resource: "Activity", action: "read" },
      { resource: "Activity", action: "create" },
      { resource: "Activity", action: "update" },
      { resource: "Activity", action: "delete" },
      { resource: "AuditLog", action: "read" },
      { resource: "Comment", action: "read" },
      { resource: "Comment", action: "create" },
      { resource: "Comment", action: "update" },
      { resource: "Comment", action: "delete" },
      { resource: "Comment", action: "pin" },
      { resource: "Comment", action: "resolve" },
      { resource: "Comment", action: "react" },
      { resource: "ResourceAllocation", action: "read" },
    ],
  },
  {
    name: "SalesRep",
    description: "Create/edit own records, convert leads, manage pipeline",
    permissions: [
      { resource: "Account", action: "read" },
      { resource: "Account", action: "create" },
      { resource: "Account", action: "update" },
      { resource: "Contact", action: "read" },
      { resource: "Contact", action: "create" },
      { resource: "Contact", action: "update" },
      { resource: "Lead", action: "read" },
      { resource: "Lead", action: "create" },
      { resource: "Lead", action: "update" },
      { resource: "Lead", action: "convert" },
      { resource: "Opportunity", action: "read" },
      { resource: "Opportunity", action: "create" },
      { resource: "Opportunity", action: "update" },
      { resource: "Activity", action: "read" },
      { resource: "Activity", action: "create" },
      { resource: "Activity", action: "update" },
      { resource: "Comment", action: "read" },
      { resource: "Comment", action: "create" },
      { resource: "Comment", action: "update" },
      { resource: "Comment", action: "react" },
      { resource: "ResourceAllocation", action: "read" },
    ],
  },
  {
    name: "ReadOnly",
    description: "View-only access to all CRM data",
    permissions: [
      { resource: "Account", action: "read" },
      { resource: "Contact", action: "read" },
      { resource: "Lead", action: "read" },
      { resource: "Opportunity", action: "read" },
      { resource: "Activity", action: "read" },
      { resource: "Comment", action: "read" },
      { resource: "ResourceAllocation", action: "read" },
    ],
  },
  {
    name: "ProductDeveloper",
    description: "View resource allocation timeline and assigned opportunities only",
    permissions: [
      { resource: "ResourceAllocation", action: "read" },
      { resource: "Opportunity", action: "readOwn" },
    ],
  },
  {
    name: "Resource",
    description: "View resource allocation timeline and opportunity pipeline timing only",
    permissions: [
      { resource: "ResourceAllocation", action: "read" },
      { resource: "Opportunity", action: "readOwn" },
    ],
  },
  {
    name: "SalesOperator",
    description: "Operate lead generation runs: stage candidates, manage runs and ICPs, perform review decisions",
    permissions: [
      { resource: "LeadGen", action: "read" },
      { resource: "LeadGen", action: "create" },
      { resource: "LeadGen", action: "update" },
      { resource: "LeadGen", action: "review" },
      { resource: "Lead", action: "read" },
      { resource: "Lead", action: "create" },
      { resource: "Lead", action: "update" },
      { resource: "Account", action: "read" },
      { resource: "Contact", action: "read" },
      { resource: "Activity", action: "read" },
      { resource: "Activity", action: "create" },
    ],
  },
  {
    name: "Reviewer",
    description: "Review staged candidates: approve, reject, or defer leads in the review queue",
    permissions: [
      { resource: "LeadGen", action: "read" },
      { resource: "LeadGen", action: "review" },
      { resource: "Lead", action: "read" },
      { resource: "Account", action: "read" },
      { resource: "Contact", action: "read" },
    ],
  },
];

// Export the seeding logic so it can be called from role initialization
export async function seedRolesAndPermissions() {
  // Check if roles already exist
  const existingRoles = await db.select().from(roles);
  if (existingRoles.length > 0) {
    console.log("Roles already exist, skipping seed");
    return;
  }
  
  // Create roles and permissions
  for (const roleConfig of defaultRoles) {
    console.log(`Creating role: ${roleConfig.name}`);
    
    // Create role
    const [createdRole] = await db.insert(roles).values({
      name: roleConfig.name,
      description: roleConfig.description,
    }).returning();
    
    // Create permissions and assign to role
    for (const permDef of roleConfig.permissions) {
      // Check if permission already exists
      const [existingPerm] = await db.select().from(permissions)
        .where(eq(permissions.resource, permDef.resource))
        .limit(1);
      
      let permissionId: string;
      
      if (existingPerm && existingPerm.action === permDef.action) {
        permissionId = existingPerm.id;
      } else {
        // Create permission
        const [createdPerm] = await db.insert(permissions).values({
          resource: permDef.resource,
          action: permDef.action,
          description: `Permission to ${permDef.action} ${permDef.resource}`,
        }).returning();
        permissionId = createdPerm.id;
      }
      
      // Assign permission to role
      await db.insert(rolePermissions).values({
        roleId: createdRole.id,
        permissionId,
      });
    }
    
    console.log(`✓ Created role ${roleConfig.name} with ${roleConfig.permissions.length} permissions`);
  }
}

// Create test admin user for development
export async function seedTestAdminUser() {
  const testEmail = "admin@test.com";
  const testPassword = "admin123";
  const testName = "Test Admin";
  
  // Check if test user already exists
  const [existingUser] = await db.select().from(users).where(eq(users.email, testEmail));
  if (existingUser) {
    console.log("Test admin user already exists, skipping");
    return;
  }
  
  console.log("Creating test admin user...");
  
  // Hash password
  const hashedPassword = await hashPassword(testPassword);
  
  // Create user
  const [user] = await db.insert(users).values({
    email: testEmail,
    name: testName,
    password: hashedPassword,
    status: "active",
  }).returning();
  
  // Assign Admin role
  const [adminRole] = await db.select().from(roles).where(eq(roles.name, "Admin"));
  if (adminRole) {
    await db.insert(userRoles).values({
      userId: user.id,
      roleId: adminRole.id,
    });
    console.log(`✓ Created test admin user: ${testEmail} / ${testPassword}`);
  } else {
    console.error("Admin role not found, cannot assign to test user");
  }
}

export async function ensureProductDeveloperRole() {
  const existingRoles = await db.select().from(roles);
  const pdRole = existingRoles.find(r => r.name === "ProductDeveloper");
  if (pdRole) {
    return;
  }

  console.log("Adding ProductDeveloper role to existing database...");

  const [createdRole] = await db.insert(roles).values({
    name: "ProductDeveloper",
    description: "View resource allocation timeline and assigned opportunities only",
  }).returning();

  const pdPerms = [
    { resource: "ResourceAllocation", action: "read" },
    { resource: "Opportunity", action: "readOwn" },
  ];

  for (const permDef of pdPerms) {
    const existing = await db.select().from(permissions)
      .where(eq(permissions.resource, permDef.resource));
    const match = existing.find(p => p.action === permDef.action);

    let permissionId: string;
    if (match) {
      permissionId = match.id;
    } else {
      const [created] = await db.insert(permissions).values({
        resource: permDef.resource,
        action: permDef.action,
        description: `Permission to ${permDef.action} ${permDef.resource}`,
      }).returning();
      permissionId = created.id;
    }

    await db.insert(rolePermissions).values({
      roleId: createdRole.id,
      permissionId,
    });
  }

  const raReadPerm = await db.select().from(permissions)
    .where(eq(permissions.resource, "ResourceAllocation"));
  const raReadId = raReadPerm.find(p => p.action === "read")?.id;
  if (raReadId) {
    for (const role of existingRoles) {
      if (["SalesManager", "SalesRep", "ReadOnly"].includes(role.name)) {
        const existingRP = await db.select().from(rolePermissions)
          .where(eq(rolePermissions.roleId, role.id));
        if (!existingRP.some(rp => rp.permissionId === raReadId)) {
          await db.insert(rolePermissions).values({
            roleId: role.id,
            permissionId: raReadId,
          });
        }
      }
    }
  }

  console.log("✓ ProductDeveloper role added successfully");
}

export async function ensureResourceRole() {
  const existingRoles = await db.select().from(roles);
  const resourceRole = existingRoles.find(r => r.name === "Resource");
  if (resourceRole) {
    return;
  }

  console.log("Adding Resource role to existing database...");

  const [createdRole] = await db.insert(roles).values({
    name: "Resource",
    description: "View resource allocation timeline and opportunity pipeline timing only",
  }).returning();

  const resourcePerms = [
    { resource: "ResourceAllocation", action: "read" },
    { resource: "Opportunity", action: "readOwn" },
  ];

  for (const permDef of resourcePerms) {
    const existing = await db.select().from(permissions)
      .where(eq(permissions.resource, permDef.resource));
    const match = existing.find(p => p.action === permDef.action);

    let permissionId: string;
    if (match) {
      permissionId = match.id;
    } else {
      const [created] = await db.insert(permissions).values({
        resource: permDef.resource,
        action: permDef.action,
        description: `Permission to ${permDef.action} ${permDef.resource}`,
      }).returning();
      permissionId = created.id;
    }

    await db.insert(rolePermissions).values({
      roleId: createdRole.id,
      permissionId,
    });
  }

  console.log("✓ Resource role added successfully");
}

export async function ensureLeadGenRoles() {
  const existingRoles = await db.select().from(roles);

  const newRoles = [
    {
      name: "SalesOperator",
      description: "Operate lead generation runs: stage candidates, manage runs and ICPs, perform review decisions",
      perms: [
        { resource: "LeadGen", action: "read" },
        { resource: "LeadGen", action: "create" },
        { resource: "LeadGen", action: "update" },
        { resource: "LeadGen", action: "review" },
        { resource: "Lead", action: "read" },
        { resource: "Lead", action: "create" },
        { resource: "Lead", action: "update" },
        { resource: "Account", action: "read" },
        { resource: "Contact", action: "read" },
        { resource: "Activity", action: "read" },
        { resource: "Activity", action: "create" },
      ],
    },
    {
      name: "Reviewer",
      description: "Review staged candidates: approve, reject, or defer leads in the review queue",
      perms: [
        { resource: "LeadGen", action: "read" },
        { resource: "LeadGen", action: "review" },
        { resource: "Lead", action: "read" },
        { resource: "Account", action: "read" },
        { resource: "Contact", action: "read" },
      ],
    },
  ];

  for (const roleDef of newRoles) {
    if (existingRoles.find(r => r.name === roleDef.name)) continue;

    console.log(`Adding ${roleDef.name} role to existing database...`);
    const [createdRole] = await db.insert(roles).values({
      name: roleDef.name,
      description: roleDef.description,
    }).returning();

    for (const permDef of roleDef.perms) {
      const existing = await db.select().from(permissions)
        .where(eq(permissions.resource, permDef.resource));
      const match = existing.find(p => p.action === permDef.action);
      let permissionId: string;
      if (match) {
        permissionId = match.id;
      } else {
        const [created] = await db.insert(permissions).values({
          resource: permDef.resource,
          action: permDef.action,
          description: `Permission to ${permDef.action} ${permDef.resource}`,
        }).returning();
        permissionId = created.id;
      }
      await db.insert(rolePermissions).values({ roleId: createdRole.id, permissionId });
    }
    console.log(`✓ ${roleDef.name} role added successfully`);
  }
}

async function seed() {
  console.log("Starting database seed...");
  
  try {
    await seedRolesAndPermissions();
    await seedTestAdminUser();
    console.log("✓ Database seed completed successfully!");
    
  } catch (error) {
    console.error("Error seeding database:", error);
    throw error;
  }
}

export async function initializeDefaultOrganization(): Promise<void> {
  try {
    // Check if any organizations exist
    const existingOrgs = await db.select().from(organizations);
    if (existingOrgs.length > 0) {
      // Check for users not yet in any org and assign them to first org
      const firstOrg = existingOrgs[0];
      const allUsers = await db.select().from(users);
      const allRoles = await db.select().from(roles);
      const adminRole = allRoles.find(r => r.name === "Admin");
      const salesRepRole = allRoles.find(r => r.name === "SalesRep");

      for (const user of allUsers) {
        const membershipCheck = await db.select().from(userOrganizations)
          .where(eq(userOrganizations.userId, user.id));
        if (membershipCheck.length === 0) {
          // Get user's global role
          const userRoleRows = await db.select().from(userRoles)
            .innerJoin(roles, eq(userRoles.roleId, roles.id))
            .where(eq(userRoles.userId, user.id));
          
          const roleId = userRoleRows.length > 0 
            ? userRoleRows[0].roles.id
            : (salesRepRole?.id || adminRole?.id || allRoles[0]?.id);
          
          if (roleId) {
            await db.insert(userOrganizations).values({
              userId: user.id,
              organizationId: firstOrg.id,
              roleId,
              isDefault: true,
            }).onConflictDoNothing();
          }
        }
      }
      // Raw-SQL backfill for lead_generation_runs.organization_id (avoids Drizzle
      // column-presence check on the nullable column that may not exist yet).
      const runBackfillResult = await db.execute(
        sql`UPDATE lead_generation_runs SET organization_id = ${firstOrg.id} WHERE organization_id IS NULL`
      );
      const runBackfillCount = (runBackfillResult as unknown as { rowCount?: number }).rowCount ?? 0;
      if (runBackfillCount > 0) {
        console.log(`  ✓ Backfilled ${runBackfillCount} lead_generation_runs rows with org ${firstOrg.id}`);
      }

      // Re-home any leads/activities that were approved before org stamping was fixed
      await repairLeadGenApprovals();

      // Backfill any CRM records that have no org assigned
      await backfillEntityOrganizations(firstOrg.id);
      return;
    }

    console.log("Creating default 'Primary Organization'...");
    
    // Get all roles
    const allRoles = await db.select().from(roles);
    const adminRole = allRoles.find(r => r.name === "Admin");
    const salesRepRole = allRoles.find(r => r.name === "SalesRep");

    // Create the primary organization
    const [primaryOrg] = await db.insert(organizations).values({
      name: "Primary Organization",
      slug: "primary",
      description: "Default organization migrated from single-tenant setup",
      settings: {},
    }).returning();

    console.log(`✓ Created organization: ${primaryOrg.name} (${primaryOrg.id})`);

    // Assign all existing users to this org with their current global role
    const allUsers = await db.select().from(users);
    for (const user of allUsers) {
      const userRoleRows = await db.select().from(userRoles)
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .where(eq(userRoles.userId, user.id));
      
      const roleId = userRoleRows.length > 0 
        ? userRoleRows[0].roles.id
        : (salesRepRole?.id || adminRole?.id || allRoles[0]?.id);
      
      if (roleId) {
        await db.insert(userOrganizations).values({
          userId: user.id,
          organizationId: primaryOrg.id,
          roleId,
          isDefault: true,
        }).onConflictDoNothing();
        console.log(`  ✓ Assigned ${user.email} to primary org with role ${userRoleRows[0]?.roles?.name || 'SalesRep'}`);
      }
    }

    // Raw-SQL backfill for lead_generation_runs.organization_id
    const runBackfillResult2 = await db.execute(
      sql`UPDATE lead_generation_runs SET organization_id = ${primaryOrg.id} WHERE organization_id IS NULL`
    );
    const runBackfillCount2 = (runBackfillResult2 as unknown as { rowCount?: number }).rowCount ?? 0;
    if (runBackfillCount2 > 0) {
      console.log(`  ✓ Backfilled ${runBackfillCount2} lead_generation_runs rows with org ${primaryOrg.id}`);
    }

    // Re-home any leads/activities that were approved before org stamping was fixed
    await repairLeadGenApprovals();

    // Backfill existing CRM entity records with the primary org ID
    await backfillEntityOrganizations(primaryOrg.id);

    console.log("✓ Default organization initialized successfully");
  } catch (error) {
    console.error("Error initializing default organization:", error);
    // Non-fatal - don't throw
  }
}

/**
 * Re-home CRM leads and activities that were created by the candidate approval
 * flow before org stamping was in place.  Idempotent — subsequent runs are no-ops.
 */
async function repairLeadGenApprovals(): Promise<void> {
  try {
    // Re-home CRM leads created from candidate approvals
    const leadResult = await db.execute(sql.raw(`
      UPDATE leads l
      SET organization_id = r.organization_id,
          updated_at = NOW()
      FROM lg_crm_leads lcl
      JOIN candidate_leads cl ON cl.id = lcl.candidate_lead_id
      JOIN lead_generation_runs r ON r.id = COALESCE(lcl.run_id, cl.run_id)
      WHERE l.id = lcl.crm_lead_id
        AND r.organization_id IS NOT NULL
        AND (l.organization_id IS DISTINCT FROM r.organization_id)
    `));
    const leadsReHomed = (leadResult as unknown as { rowCount?: number }).rowCount ?? 0;

    // Re-home activities created from playbook steps during approval
    const activityResult = await db.execute(sql.raw(`
      UPDATE activities a
      SET organization_id = r.organization_id,
          updated_at = NOW()
      FROM lg_crm_tasks lct
      JOIN candidate_leads cl ON cl.id = lct.candidate_lead_id
      JOIN lead_generation_runs r ON r.id = COALESCE(lct.run_id, cl.run_id)
      WHERE a.id = lct.activity_id
        AND r.organization_id IS NOT NULL
        AND (a.organization_id IS DISTINCT FROM r.organization_id)
    `));
    const activitiesReHomed = (activityResult as unknown as { rowCount?: number }).rowCount ?? 0;

    if (leadsReHomed > 0 || activitiesReHomed > 0) {
      console.log(`  ✓ repairLeadGenApprovals: re-homed ${leadsReHomed} leads, ${activitiesReHomed} activities`);
    }
  } catch (err) {
    // Tables may not exist in all environments (e.g. lg_crm_leads not yet created)
    console.warn("repairLeadGenApprovals skipped (tables may not exist yet):", (err as Error).message);
  }
}

async function backfillEntityOrganizations(orgId: string): Promise<void> {
  const { accounts, contacts, leads, opportunities, activities, icpProfiles, taskPlaybooks, leadGenerationRuns, llmConfigurations, apiKeys } = await import("@shared/schema");
  const { isNull } = await import("drizzle-orm");

  // Wrap each table individually so a missing column on one table does not
  // abort the entire backfill — log the specific failure for diagnostics.
  const coreTables: Array<{ name: string; fn: () => Promise<unknown> }> = [
    { name: "accounts",            fn: () => db.update(accounts).set({ organizationId: orgId }).where(isNull(accounts.organizationId)) },
    { name: "contacts",            fn: () => db.update(contacts).set({ organizationId: orgId }).where(isNull(contacts.organizationId)) },
    { name: "leads",               fn: () => db.update(leads).set({ organizationId: orgId }).where(isNull(leads.organizationId)) },
    { name: "opportunities",       fn: () => db.update(opportunities).set({ organizationId: orgId }).where(isNull(opportunities.organizationId)) },
    { name: "activities",          fn: () => db.update(activities).set({ organizationId: orgId }).where(isNull(activities.organizationId)) },
    { name: "icpProfiles",         fn: () => db.update(icpProfiles).set({ organizationId: orgId }).where(isNull(icpProfiles.organizationId)) },
    { name: "taskPlaybooks",       fn: () => db.update(taskPlaybooks).set({ organizationId: orgId }).where(isNull(taskPlaybooks.organizationId)) },
    { name: "leadGenerationRuns",  fn: () => db.update(leadGenerationRuns).set({ organizationId: orgId }).where(isNull(leadGenerationRuns.organizationId)) },
    { name: "llmConfigurations",   fn: () => db.update(llmConfigurations).set({ organizationId: orgId }).where(isNull(llmConfigurations.organizationId)) },
    { name: "apiKeys",             fn: () => db.update(apiKeys).set({ organizationId: orgId }).where(isNull(apiKeys.organizationId)) },
  ];

  for (const { name, fn } of coreTables) {
    try {
      await fn();
    } catch (err) {
      console.warn(`  backfillEntityOrganizations: skipped ${name} — ${(err as Error).message}`);
    }
  }

  // Initialize org-specific ID patterns and account categories
  await initializeOrgSettings(orgId);
  console.log("✓ Backfilled existing CRM, lead-gen, and admin records with primary org ID");
}

/**
 * Initialize org-specific settings (ID patterns, account categories) for a new or existing org.
 * Idempotent: skips if the org already has its own settings.
 */
export async function initializeOrgSettings(orgId: string): Promise<void> {
  const { idPatterns, accountCategories } = await import("@shared/schema");
  const { isNull: isNullOp, eq: eqOp } = await import("drizzle-orm");

  // --- ID Patterns ---
  const existingPatterns = await db.select().from(idPatterns)
    .where(eqOp(idPatterns.organizationId, orgId));

  if (existingPatterns.length === 0) {
    // Copy global patterns (null org) to org-specific; reset counters for a fresh org
    const globalPatterns = await db.select().from(idPatterns)
      .where(isNullOp(idPatterns.organizationId));

    if (globalPatterns.length > 0) {
      for (const p of globalPatterns) {
        await db.insert(idPatterns).values({
          entity: p.entity,
          pattern: p.pattern,
          startValue: p.startValue,
          counter: 0,
          lastIssued: null,
          organizationId: orgId,
        }).onConflictDoNothing();
      }
    } else {
      // No global templates exist — seed defaults directly
      const defaults = [
        { entity: "Account", pattern: "ACCT-{YYYY}-{SEQ:5}" },
        { entity: "Contact", pattern: "CONT-{YY}{MM}-{SEQ:5}" },
        { entity: "Lead", pattern: "LEAD-{SEQ:6}" },
        { entity: "Opportunity", pattern: "OPP-{YYYY}-{SEQ:6}" },
        { entity: "Activity", pattern: "ACT-{YY}{MM}-{SEQ:5}" },
        { entity: "Document", pattern: "DOC-{SEQ:6}" },
      ];
      for (const d of defaults) {
        await db.insert(idPatterns).values({
          ...d, counter: 0, startValue: 1, organizationId: orgId,
        }).onConflictDoNothing();
      }
    }
  }

  // --- Account Categories ---
  const existingCategories = await db.select().from(accountCategories)
    .where(eqOp(accountCategories.organizationId, orgId));

  if (existingCategories.length === 0) {
    const globalCategories = await db.select().from(accountCategories)
      .where(isNullOp(accountCategories.organizationId));

    for (const c of globalCategories) {
      await db.insert(accountCategories).values({
        name: c.name,
        description: c.description,
        isActive: c.isActive,
        organizationId: orgId,
      }).onConflictDoNothing();
    }
  }
}

export { seed };
