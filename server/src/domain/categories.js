// Average item weight and embodied CO2 per kg of product, per repair category.
// The factors are rounded, illustrative estimates for a demo, inspired by the
// kind of figures repair networks publish. They are not audited LCA data.
export const CATEGORIES = {
  electronics: { label: 'Electronics', icon: '📻', avgWeightKg: 1.5, co2PerKg: 25 },
  computers: { label: 'Computers & phones', icon: '💻', avgWeightKg: 1.2, co2PerKg: 60 },
  appliances: { label: 'Kitchen appliances', icon: '☕', avgWeightKg: 3, co2PerKg: 8 },
  textiles: { label: 'Textiles', icon: '🧵', avgWeightKg: 0.6, co2PerKg: 15 },
  bikes: { label: 'Bikes', icon: '🚲', avgWeightKg: 14, co2PerKg: 6 },
  furniture: { label: 'Furniture & lamps', icon: '🪑', avgWeightKg: 6, co2PerKg: 4 },
  toys: { label: 'Toys', icon: '🧸', avgWeightKg: 0.8, co2PerKg: 6 },
  jewelry: { label: 'Jewelry & watches', icon: '⌚', avgWeightKg: 0.1, co2PerKg: 40 },
};

export const OUTCOMES = ['fixed', 'partial', 'advice', 'not_fixable'];

export const isCategory = (c) => Object.hasOwn(CATEGORIES, c);
