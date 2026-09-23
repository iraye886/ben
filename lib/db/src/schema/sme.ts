import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const businessesTable = pgTable("sme_businesses", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  ownerClerkId: text("owner_clerk_id").notNull().unique(),
  phone: text("phone"),
  address: text("address"),
  currency: text("currency").notNull().default("NGN"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const productsTable = pgTable("sme_products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  sku: text("sku").notNull().unique(),
  category: text("category").notNull(),
  price: numeric("price", { precision: 12, scale: 2 }).notNull(),
  cost: numeric("cost", { precision: 12, scale: 2 }).notNull(),
  stock: integer("stock").notNull().default(0),
  minStock: integer("min_stock").notNull().default(0),
  unit: text("unit").notNull().default("unit"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const salesTable = pgTable("sme_sales", {
  id: serial("id").primaryKey(),
  invoiceNumber: text("invoice_number").notNull().unique(),
  customerName: text("customer_name").notNull().default("Walk-in customer"),
  paymentMethod: text("payment_method").notNull(),
  items: jsonb("items").notNull(),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull(),
  total: numeric("total", { precision: 12, scale: 2 }).notNull(),
  status: text("status").notNull().default("paid"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const expensesTable = pgTable("sme_expenses", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  expenseDate: date("expense_date", { mode: "string" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const usersTable = pgTable("sme_users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  clerkUserId: text("clerk_user_id"),
  passkeyHash: text("passkey_hash"),
  role: text("role").notNull(),
  status: text("status").notNull().default("active"),
  lastActive: timestamp("last_active", { withTimezone: true }).notNull().defaultNow(),
});

export const activityTable = pgTable("sme_activity", {
  id: serial("id").primaryKey(),
  action: text("action").notNull(),
  description: text("description").notNull(),
  actor: text("actor").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProductSchema = createInsertSchema(productsTable).omit({
  id: true,
  createdAt: true,
});
export const insertSaleSchema = createInsertSchema(salesTable).omit({
  id: true,
  createdAt: true,
});
export const insertExpenseSchema = createInsertSchema(expensesTable).omit({
  id: true,
  createdAt: true,
});
export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true });
export const insertActivitySchema = createInsertSchema(activityTable).omit({
  id: true,
  createdAt: true,
});

export type Product = typeof productsTable.$inferSelect;
export type Sale = typeof salesTable.$inferSelect;
export type Expense = typeof expensesTable.$inferSelect;
export type SmeUser = typeof usersTable.$inferSelect;
export type Activity = typeof activityTable.$inferSelect;
export type Business = typeof businessesTable.$inferSelect;

export const saleItemSchema = z.object({
  productId: z.number().int(),
  name: z.string(),
  quantity: z.number().int(),
  unitPrice: z.number(),
  total: z.number(),
});