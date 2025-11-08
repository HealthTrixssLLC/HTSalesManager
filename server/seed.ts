// Database seeding script to initialize roles and permissions
// Run this script to populate the database with default data

import { db } from "./db";
import { roles, permissions, rolePermissions, users, userRoles } from "@shared/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "./auth";

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

export { seed };

// Run seed if called directly (ES modules check)
if (import.meta.url === `file://${process.argv[1]}`) {
  seed()
    .then(() => {
      console.log("Seed completed");
      process.exit(0);
    })
    .catch((error) => {
      console.error("Seed failed:", error);
      process.exit(1);
    });
}
