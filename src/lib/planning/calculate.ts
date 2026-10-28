export type Scenario = {
  timezone: string;
  order_cutoff: string;
  week_start: string;
  week_end: string;
  settings: {
    permanent_shift_start: string;
    permanent_shift_end: string;
    permanent_break_start: string;
    permanent_break_minutes: number;
    permanent_productive_hours: number;
    part_time_productive_hours: number;
    max_shifts_per_person_per_day: number;
  };
};

export type Recipes = {
  products: Array<{ id: string; name: string; labour_hours_per_unit: number }>;
  recipes: Array<{ product_id: string; ingredient_id: string; quantity_per_unit: number }>;
};

export type Order = {
  id: string; productionDate: string; customer: string; productId: string;
  quantity: number; status: string; receivedAt: string;
};
export type Staff = { id: string; name: string; employmentType: string; role: string; skills: string[] };
export type Leave = { id: string; staffId: string; date: string; status: string; reason: string | null };
export type Availability = { staffId: string; date: string; start: string; end: string; status: string };
export type Stock = {
  ingredientId: string; name: string; unit: string; onHand: number;
  committed: number; packSize: number; packName: string; checkedAt: string;
};
export type PlanningInput = {
  scenario: Scenario; recipes: Recipes; orders: Order[]; staff: Staff[];
  leave: Leave[]; availability: Availability[]; stock: Stock[];
};

export type ExcludedOrder = Order & { reason: "not_confirmed" | "outside_week" | "after_cutoff" };
export type DailyProduction = {
  date: string;
  products: Array<{ productId: string; productName: string; quantity: number; labourHours: number }>;
  totalUnits: number;
  labourHours: number;
};
export type RosterAssignment = {
  staffId: string; name: string; role: string; employmentType: string;
  start: string; end: string; productiveHours: number; supervisorQualified: boolean;
};
export type DailyRoster = {
  date: string; requiredHours: number; assignedHours: number; uncoveredHours: number;
  additionalPartTimeShiftsToRequest: number; supervisorCovered: boolean;
  assignments: RosterAssignment[];
  pendingLeaveAlerts: Array<{ staffId: string; name: string; reason: string | null }>;
};
export type StockRequest = {
  ingredientId: string; name: string; unit: string; demand: number;
  onHand: number; committed: number; usableStock: number; shortage: number;
  packSize: number; packName: string; packsToRequest: number; requestedQuantity: number;
};
export type CalculatedPlan = {
  timezone: string; weekStart: string; weekEnd: string; orderCutoff: string;
  eligibleOrders: Order[]; excludedOrders: ExcludedOrder[];
  dailyProduction: DailyProduction[]; totalUnits: number; totalLabourHours: number;
  roster: DailyRoster[]; stockRequests: StockRequest[];
};

function round(value: number) { return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000; }
function dateRange(start: string, end: string) {
  const dates: string[] = [];
  const current = new Date(`${start}T00:00:00.000Z`);
  const last = new Date(`${end}T00:00:00.000Z`);
  if (Number.isNaN(current.valueOf()) || Number.isNaN(last.valueOf()) || current > last) throw new Error("The planning week is invalid.");
  while (current <= last) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}
function byHoursThenName(hours: Map<string, number>) {
  return (a: Staff, b: Staff) => (hours.get(a.id) ?? 0) - (hours.get(b.id) ?? 0) ||
    (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function calculatePlan(input: PlanningInput): CalculatedPlan {
  const { scenario, recipes, orders, staff, leave, availability, stock } = input;
  if (scenario.settings.max_shifts_per_person_per_day !== 1) throw new Error("The roster requires one shift per person per day.");
  const dates = dateRange(scenario.week_start, scenario.week_end);
  const cutoff = new Date(scenario.order_cutoff);
  if (Number.isNaN(cutoff.valueOf())) throw new Error("The order cutoff is invalid.");
  const products = new Map(recipes.products.map((product) => [product.id, product]));
  const stockById = new Map(stock.map((item) => [item.ingredientId, item]));
  const staffById = new Map(staff.map((person) => [person.id, person]));
  const eligibleOrders: Order[] = [];
  const excludedOrders: ExcludedOrder[] = [];
  for (const order of orders) {
    if (!products.has(order.productId)) throw new Error(`Unknown saved product ${order.productId}.`);
    const reason = order.status !== "Confirmed" ? "not_confirmed" :
      order.productionDate < scenario.week_start || order.productionDate > scenario.week_end ? "outside_week" :
      new Date(order.receivedAt) > cutoff ? "after_cutoff" : null;
    if (reason) excludedOrders.push({ ...order, reason });
    else eligibleOrders.push(order);
  }
  eligibleOrders.sort((a, b) => a.productionDate.localeCompare(b.productionDate) || a.id.localeCompare(b.id));
  excludedOrders.sort((a, b) => a.productionDate.localeCompare(b.productionDate) || a.id.localeCompare(b.id));

  const dailyProduction = dates.map((date) => {
    const productsForDay = recipes.products.map((product) => {
      const quantity = eligibleOrders.filter((order) => order.productionDate === date && order.productId === product.id)
        .reduce((sum, order) => sum + order.quantity, 0);
      return { productId: product.id, productName: product.name, quantity, labourHours: round(quantity * product.labour_hours_per_unit) };
    });
    return { date, products: productsForDay, totalUnits: productsForDay.reduce((sum, product) => sum + product.quantity, 0),
      labourHours: round(productsForDay.reduce((sum, product) => sum + product.labourHours, 0)) };
  });

  const demand = new Map<string, number>();
  for (const recipe of recipes.recipes) {
    if (!products.has(recipe.product_id)) throw new Error(`Recipe has unknown product ${recipe.product_id}.`);
    if (!stockById.has(recipe.ingredient_id)) throw new Error(`No stock count for ingredient ${recipe.ingredient_id}.`);
    const units = dailyProduction.reduce((sum, day) => sum + (day.products.find((product) => product.productId === recipe.product_id)?.quantity ?? 0), 0);
    demand.set(recipe.ingredient_id, round((demand.get(recipe.ingredient_id) ?? 0) + units * recipe.quantity_per_unit));
  }
  const stockRequests = stock.map((item) => {
    const ingredientDemand = demand.get(item.ingredientId) ?? 0;
    const usableStock = round(item.onHand - item.committed);
    const shortage = round(Math.max(0, ingredientDemand - usableStock));
    const packsToRequest = Math.ceil(shortage / item.packSize);
    return { ingredientId: item.ingredientId, name: item.name, unit: item.unit, demand: ingredientDemand,
      onHand: item.onHand, committed: item.committed, usableStock, shortage,
      packSize: item.packSize, packName: item.packName, packsToRequest, requestedQuantity: round(packsToRequest * item.packSize) };
  }).sort((a, b) => a.ingredientId.localeCompare(b.ingredientId));

  const approvedLeave = new Set(leave.filter((item) => item.status === "Approved").map((item) => `${item.staffId}:${item.date}`));
  const weeklyHours = new Map<string, number>();
  const roster = dailyProduction.map((day) => {
    const assigned = new Set<string>();
    const assignments: RosterAssignment[] = [];
    const weekday = new Date(`${day.date}T00:00:00.000Z`).getUTCDay();
    const canWork = (person: Staff) => person.skills.includes("production") && !approvedLeave.has(`${person.id}:${day.date}`);
    const permanent = staff.filter((person) => person.employmentType === "Permanent" && weekday >= 1 && weekday <= 5 && canWork(person));
    const partTime = staff.filter((person) => person.employmentType === "Part-time" && canWork(person) &&
      availability.some((shift) => shift.staffId === person.id && shift.date === day.date && shift.status === "Confirmed"));
    const add = (person: Staff) => {
      if (assigned.has(person.id)) return;
      const shift = person.employmentType === "Permanent" ? null : availability.find((item) => item.staffId === person.id && item.date === day.date && item.status === "Confirmed");
      if (person.employmentType === "Part-time" && !shift) return;
      const productiveHours = person.employmentType === "Permanent" ? scenario.settings.permanent_productive_hours : scenario.settings.part_time_productive_hours;
      assignments.push({ staffId: person.id, name: person.name, role: person.role, employmentType: person.employmentType,
        start: shift?.start ?? scenario.settings.permanent_shift_start, end: shift?.end ?? scenario.settings.permanent_shift_end,
        productiveHours, supervisorQualified: person.skills.includes("supervisor") && person.role === "Kitchen lead" });
      assigned.add(person.id);
      weeklyHours.set(person.id, round((weeklyHours.get(person.id) ?? 0) + productiveHours));
    };
    if (day.totalUnits > 0) {
      const isLead = (person: Staff) => person.skills.includes("supervisor") && person.role === "Kitchen lead";
      const lead = [...permanent].sort(byHoursThenName(weeklyHours)).find(isLead) ?? [...partTime].sort(byHoursThenName(weeklyHours)).find(isLead);
      if (lead) add(lead);
      for (const pool of [permanent, partTime]) {
        while (round(day.labourHours - assignments.reduce((sum, assignment) => sum + assignment.productiveHours, 0)) > 0) {
          const next = pool.filter((person) => !assigned.has(person.id)).sort(byHoursThenName(weeklyHours))[0];
          if (!next) break;
          add(next);
        }
      }
    }
    const assignedHours = round(assignments.reduce((sum, assignment) => sum + assignment.productiveHours, 0));
    const uncoveredHours = round(Math.max(0, day.labourHours - assignedHours));
    const pendingLeaveAlerts = leave.filter((item) => item.date === day.date && item.status === "Pending")
      .map((item) => ({ staffId: item.staffId, name: staffById.get(item.staffId)?.name ?? item.staffId, reason: item.reason }));
    return { date: day.date, requiredHours: day.labourHours, assignedHours, uncoveredHours,
      additionalPartTimeShiftsToRequest: Math.ceil(uncoveredHours / scenario.settings.part_time_productive_hours),
      supervisorCovered: day.totalUnits === 0 || assignments.some((assignment) => assignment.supervisorQualified),
      assignments, pendingLeaveAlerts };
  });

  return { timezone: scenario.timezone, weekStart: scenario.week_start, weekEnd: scenario.week_end,
    orderCutoff: scenario.order_cutoff, eligibleOrders, excludedOrders, dailyProduction,
    totalUnits: dailyProduction.reduce((sum, day) => sum + day.totalUnits, 0),
    totalLabourHours: round(dailyProduction.reduce((sum, day) => sum + day.labourHours, 0)), roster, stockRequests };
}
