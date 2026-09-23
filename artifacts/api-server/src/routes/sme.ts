import { Router, type IRouter, type RequestHandler } from "express";
import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import {
  CreateExpenseBody,
  CreateProductBody,
  CreateSaleBody,
  CreateUserBody,
  GetActivityResponse,
  GetDashboardSummaryResponse,
  GetExpensesQueryParams,
  GetExpensesResponse,
  GetFinancialReportResponse,
  GetProductsQueryParams,
  GetProductsResponse,
  GetSalesQueryParams,
  GetSalesResponse,
  GetUsersResponse,
  UpdateProductBody,
  UpdateProductParams,
  UpdateUserBody,
  UpdateUserParams,
} from "@workspace/api-zod";
import {
  activityTable,
  db,
  expensesTable,
  productsTable,
  salesTable,
  usersTable,
} from "@workspace/db";
import { requireRole, requireSignedIn } from "./auth";

const router: IRouter = Router();
router.use(requireSignedIn);

type SaleItem = {
  productId: number;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
};

const asMoney = (value: string | number | null | undefined): number =>
  Number(value ?? 0);

const productDto = (product: typeof productsTable.$inferSelect) => ({
  ...product,
  price: asMoney(product.price),
  cost: asMoney(product.cost),
});

const saleDto = (sale: typeof salesTable.$inferSelect) => ({
  ...sale,
  customerName: sale.customerName || "Walk-in customer",
  items: sale.items as SaleItem[],
  subtotal: asMoney(sale.subtotal),
  total: asMoney(sale.total),
});

const expenseDto = (expense: typeof expensesTable.$inferSelect) => ({
  ...expense,
  amount: asMoney(expense.amount),
});

const dateForPeriod = (period: string): Date | undefined => {
  if (period === "all") return undefined;
  const date = new Date();
  if (period === "today") date.setHours(0, 0, 0, 0);
  if (period === "week") date.setDate(date.getDate() - 7);
  if (period === "month") date.setDate(1);
  return date;
};

const addActivity = async (
  action: string,
  description: string,
  actor = "System administrator",
) => {
  await db.insert(activityTable).values({ action, description, actor });
};

router.get("/dashboard/summary", requireRole("administrator", "manager"), async (_req, res): Promise<void> => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const [products, sales, expenses, recentSales, lowStockProducts] =
    await Promise.all([
      db.select().from(productsTable),
      db.select().from(salesTable),
      db.select().from(expensesTable),
      db.select().from(salesTable).orderBy(desc(salesTable.createdAt)).limit(5),
      db
        .select()
        .from(productsTable)
        .where(
          and(
            eq(productsTable.active, true),
            sql`${productsTable.stock} <= ${productsTable.minStock}`,
          ),
        )
        .orderBy(productsTable.stock)
        .limit(5),
    ]);

  const monthSales = sales.filter((sale) => sale.createdAt >= monthStart);
  const todaySales = sales.filter((sale) => sale.createdAt >= today);
  const monthExpenses = expenses.filter((expense) => expense.createdAt >= monthStart);
  const monthRevenue = monthSales.reduce((sum, sale) => sum + asMoney(sale.total), 0);
  const expenseTotal = monthExpenses.reduce(
    (sum, expense) => sum + asMoney(expense.amount),
    0,
  );

  res.json(
    GetDashboardSummaryResponse.parse({
      todayRevenue: todaySales.reduce((sum, sale) => sum + asMoney(sale.total), 0),
      monthRevenue,
      monthExpenses: expenseTotal,
      monthProfit: monthRevenue - expenseTotal,
      totalProducts: products.filter((product) => product.active).length,
      lowStockCount: products.filter(
        (product) => product.active && product.stock <= product.minStock,
      ).length,
      salesCount: monthSales.length,
      recentSales: recentSales.map(saleDto),
      lowStockProducts: lowStockProducts.map(productDto),
    }),
  );
});

router.get("/products", requireRole("administrator", "manager", "cashier"), async (req, res): Promise<void> => {
  const query = GetProductsQueryParams.parse(req.query);
  const filters = [];
  if (query.search) {
    filters.push(
      or(
        ilike(productsTable.name, `%${query.search}%`),
        ilike(productsTable.sku, `%${query.search}%`),
        ilike(productsTable.category, `%${query.search}%`),
      ),
    );
  }
  if (query.stock === "low") {
    filters.push(sql`${productsTable.stock} <= ${productsTable.minStock}`);
  }
  if (query.stock === "out") filters.push(eq(productsTable.stock, 0));
  const products = await db
    .select()
    .from(productsTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(productsTable.name);
  res.json(GetProductsResponse.parse(products.map(productDto)));
});

router.post("/products", requireRole("administrator", "manager", "cashier"), async (req, res): Promise<void> => {
  const parsed = CreateProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [product] = await db
    .insert(productsTable)
    .values({
      ...parsed.data,
      price: String(parsed.data.price),
      cost: String(parsed.data.cost),
    })
    .returning();
  await addActivity("Product added", `${product.name} was added to inventory.`);
  res.status(201).json(productDto(product));
});

router.patch("/products/:id", requireRole("administrator", "manager", "cashier"), async (req, res): Promise<void> => {
  const params = UpdateProductParams.safeParse(req.params);
  const parsed = UpdateProductBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid product update." });
    return;
  }
  const values: Partial<typeof productsTable.$inferInsert> = {};
  if (parsed.data.name !== undefined) values.name = parsed.data.name;
  if (parsed.data.sku !== undefined) values.sku = parsed.data.sku;
  if (parsed.data.category !== undefined) values.category = parsed.data.category;
  if (parsed.data.price !== undefined) values.price = String(parsed.data.price);
  if (parsed.data.cost !== undefined) values.cost = String(parsed.data.cost);
  if (parsed.data.stock !== undefined) values.stock = parsed.data.stock;
  if (parsed.data.minStock !== undefined) values.minStock = parsed.data.minStock;
  if (parsed.data.unit !== undefined) values.unit = parsed.data.unit;
  if (parsed.data.active !== undefined) values.active = parsed.data.active;
  const [product] = await db
    .update(productsTable)
    .set(values)
    .where(eq(productsTable.id, params.data.id))
    .returning();
  if (!product) {
    res.status(404).json({ error: "Product not found." });
    return;
  }
  await addActivity("Product updated", `${product.name} was updated.`);
  res.json(productDto(product));
});

router.delete("/products/:id", requireRole("administrator", "manager", "cashier"), async (req, res): Promise<void> => {
  const params = UpdateProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid product id." });
    return;
  }
  const [product] = await db
    .update(productsTable)
    .set({ active: false })
    .where(eq(productsTable.id, params.data.id))
    .returning();
  if (!product) {
    res.status(404).json({ error: "Product not found." });
    return;
  }
  await addActivity("Product archived", `${product.name} was archived.`);
  res.sendStatus(204);
});

router.get("/sales", requireRole("administrator", "manager", "cashier"), async (req, res): Promise<void> => {
  const query = GetSalesQueryParams.parse(req.query);
  const start = dateForPeriod(query.period);
  const filters = start ? [gte(salesTable.createdAt, start)] : [];
  if (query.search) {
    filters.push(
      or(
        ilike(salesTable.invoiceNumber, `%${query.search}%`),
        ilike(salesTable.customerName, `%${query.search}%`),
      )!,
    );
  }
  const sales = await db
    .select()
    .from(salesTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(salesTable.createdAt));
  res.json(GetSalesResponse.parse(sales.map(saleDto)));
});

router.post("/sales", requireRole("administrator", "manager", "cashier"), async (req, res): Promise<void> => {
  const parsed = CreateSaleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const productIds = parsed.data.items.map((item) => item.productId);
  const products = await db
    .select()
    .from(productsTable)
    .where(inArray(productsTable.id, productIds));
  const productById = new Map(products.map((product) => [product.id, product]));
  const saleItems: SaleItem[] = [];
  for (const item of parsed.data.items) {
    const product = productById.get(item.productId);
    if (!product || !product.active) {
      res.status(400).json({ error: "One or more products are unavailable." });
      return;
    }
    if (product.stock < item.quantity) {
      res.status(400).json({ error: `${product.name} does not have enough stock.` });
      return;
    }
    const unitPrice = asMoney(product.price);
    saleItems.push({
      productId: product.id,
      name: product.name,
      quantity: item.quantity,
      unitPrice,
      total: unitPrice * item.quantity,
    });
  }
  const total = saleItems.reduce((sum, item) => sum + item.total, 0);
  const invoiceNumber = `INV-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
  const sale = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(salesTable)
      .values({
        invoiceNumber,
        customerName: parsed.data.customerName ?? "Walk-in customer",
        paymentMethod: parsed.data.paymentMethod,
        items: saleItems,
        subtotal: String(total),
        total: String(total),
      })
      .returning();
    for (const item of saleItems) {
      const product = productById.get(item.productId)!;
      await tx
        .update(productsTable)
        .set({ stock: product.stock - item.quantity })
        .where(eq(productsTable.id, item.productId));
    }
    await tx.insert(activityTable).values({
      action: "Sale recorded",
      description: `${invoiceNumber} was recorded for ₦${total.toLocaleString()}.`,
      actor: "System administrator",
    });
    return created;
  });
  res.status(201).json(saleDto(sale));
});

router.get("/expenses", requireRole("administrator", "manager"), async (req, res): Promise<void> => {
  const query = GetExpensesQueryParams.parse(req.query);
  const period = query.period;
  const start = dateForPeriod(period);
  const expenses = await db
    .select()
    .from(expensesTable)
    .where(start ? gte(expensesTable.createdAt, start) : undefined)
    .orderBy(desc(expensesTable.expenseDate), desc(expensesTable.createdAt));
  res.json(GetExpensesResponse.parse(expenses.map(expenseDto)));
});

router.post("/expenses", requireRole("administrator", "manager"), async (req, res): Promise<void> => {
  const parsed = CreateExpenseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [expense] = await db
    .insert(expensesTable)
    .values({
      ...parsed.data,
      amount: String(parsed.data.amount),
      expenseDate: parsed.data.expenseDate.toISOString().slice(0, 10),
    })
    .returning();
  await addActivity("Expense recorded", `${expense.description} was recorded.`);
  res.status(201).json(expenseDto(expense));
});

router.get("/reports/financial", requireRole("administrator", "manager"), async (req, res): Promise<void> => {
  const now = new Date();
  const from =
    typeof req.query.from === "string"
      ? new Date(req.query.from)
      : new Date(now.getFullYear(), now.getMonth(), 1);
  const to =
    typeof req.query.to === "string"
      ? new Date(`${req.query.to}T23:59:59`)
      : now;
  const [sales, expenses] = await Promise.all([
    db
      .select()
      .from(salesTable)
      .where(and(gte(salesTable.createdAt, from), lte(salesTable.createdAt, to))),
    db
      .select()
      .from(expensesTable)
      .where(and(gte(expensesTable.createdAt, from), lte(expensesTable.createdAt, to))),
  ]);
  const breakdown = new Map<string, number>();
  for (const expense of expenses) {
    breakdown.set(
      expense.category,
      (breakdown.get(expense.category) ?? 0) + asMoney(expense.amount),
    );
  }
  const revenue = sales.reduce((sum, sale) => sum + asMoney(sale.total), 0);
  const expenseTotal = expenses.reduce((sum, expense) => sum + asMoney(expense.amount), 0);
  res.json(
    GetFinancialReportResponse.parse({
      from,
      to,
      revenue,
      expenses: expenseTotal,
      profit: revenue - expenseTotal,
      salesCount: sales.length,
      expenseBreakdown: [...breakdown].map(([category, amount]) => ({ category, amount })),
    }),
  );
});

router.get("/users", requireRole("administrator"), async (_req, res): Promise<void> => {
  const users = await db.select().from(usersTable).orderBy(usersTable.name);
  res.json(GetUsersResponse.parse(users));
});

router.post("/users", requireRole("administrator"), async (req, res): Promise<void> => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [user] = await db
    .insert(usersTable)
    .values({ ...parsed.data, status: "active" })
    .returning();
  await addActivity("User added", `${user.name} was added as a ${user.role}.`);
  res.status(201).json(user);
});

router.patch("/users/:id", requireRole("administrator"), async (req, res): Promise<void> => {
  const params = UpdateUserParams.safeParse(req.params);
  const parsed = UpdateUserBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid user update." });
    return;
  }
  const [user] = await db
    .update(usersTable)
    .set(parsed.data)
    .where(eq(usersTable.id, params.data.id))
    .returning();
  if (!user) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  await addActivity("User updated", `${user.name}'s access was updated.`);
  res.json(user);
});

router.get("/activity", requireRole("administrator"), async (_req, res): Promise<void> => {
  const activity = await db
    .select()
    .from(activityTable)
    .orderBy(desc(activityTable.createdAt))
    .limit(20);
  res.json(GetActivityResponse.parse(activity));
});

export default router;