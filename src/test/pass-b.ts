// Test helper: answer a Pass B (schema-constrained) request with values by
// eBay aspect name, the way the model would (keys come from the schema).
export function passBAnswer(body: unknown, byName: Record<string, string | string[]>): { choices: Array<{ message: { content: string } }> } {
  const schema = (body as { response_format?: { json_schema?: { schema?: { properties?: Record<string, { description?: string }> } } } })
    ?.response_format?.json_schema?.schema;
  const out: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(schema?.properties ?? {})) {
    const name = Object.keys(byName).find((n) => (prop.description ?? "").startsWith(n));
    out[key] = name === undefined ? null : byName[name];
  }
  return { choices: [{ message: { content: JSON.stringify(out) } }] };
}
