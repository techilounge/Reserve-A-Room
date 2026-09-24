// Generates src/lib/supabase/database.types.ts from the migrations, in the same shape
// as `supabase gen types typescript`. It applies every migration to an in-process
// Postgres (PGlite) and reads the catalog, so no Docker or linked project is needed.
//
//   npm run db:types
//
// Once the project is linked, `npx supabase gen types typescript --linked` produces an
// equivalent file and can replace this script.
import { writeFileSync } from "node:fs";
import path from "node:path";

import { createTestDb } from "../supabase/tests/support/db.ts";

const OUT = path.resolve(import.meta.dirname, "..", "src/lib/supabase/database.types.ts");

type Column = {
  table_name: string;
  column_name: string;
  udt_name: string;
  data_type: string;
  is_nullable: "YES" | "NO";
  column_default: string | null;
  is_generated: "ALWAYS" | "NEVER";
  is_identity: "YES" | "NO";
  identity_generation: string | null;
};

const db = await createTestDb();

const enums = (
  await db.query<{ name: string; labels: string[] }>(
    `select t.typname as name, array_agg(e.enumlabel order by e.enumsortorder) as labels
     from pg_type t join pg_enum e on e.enumtypid = t.oid
     join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' group by t.typname order by t.typname`,
  )
).rows;
const enumNames = new Set(enums.map((e) => e.name));

const tables = (
  await db.query<{ table_name: string }>(
    `select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
  )
).rows.map((r) => r.table_name);

const columns = (
  await db.query<Column>(
    `select table_name, column_name, udt_name, data_type, is_nullable, column_default,
            is_generated, is_identity, identity_generation
     from information_schema.columns where table_schema = 'public'
     order by table_name, ordinal_position`,
  )
).rows;

const fks = (
  await db.query<{ name: string; table_name: string; columns: string[]; ref_table: string; ref_columns: string[]; one_to_one: boolean }>(
    `select c.conname as name, cl.relname as table_name,
            array(select a.attname from unnest(c.conkey) k join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k) as columns,
            rcl.relname as ref_table,
            array(select a.attname from unnest(c.confkey) k join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k) as ref_columns,
            exists (
              select 1 from pg_index i
              where i.indrelid = c.conrelid and i.indisunique
                and (select array_agg(x order by x) from unnest(i.indkey::int2[]) x) = (select array_agg(x order by x) from unnest(c.conkey) x)
            ) as one_to_one
     from pg_constraint c
     join pg_class cl on cl.oid = c.conrelid
     join pg_namespace n on n.oid = cl.relnamespace
     join pg_class rcl on rcl.oid = c.confrelid
     join pg_namespace rn on rn.oid = rcl.relnamespace
     where c.contype = 'f' and n.nspname = 'public' and rn.nspname = 'public'
     order by c.conname`,
  )
).rows;

const functions = (
  await db.query<{
    name: string;
    arg_names: string[] | null;
    arg_modes: string[] | null;
    all_arg_types: string[];
    arg_defaults: number;
    return_type: string;
    returns_set: boolean;
  }>(
    `select p.proname as name, p.proargnames as arg_names, p.proargmodes::text[] as arg_modes,
            array(select format_type(t, null) from unnest(coalesce(p.proallargtypes, p.proargtypes::oid[])) t) as all_arg_types,
            p.pronargdefaults as arg_defaults, format_type(p.prorettype, null) as return_type, p.proretset as returns_set
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and format_type(p.prorettype, null) <> 'trigger'
     order by p.proname`,
  )
).rows.map((fn) => {
  // proargmodes is null when every argument is IN. 't'/'o' are RETURNS TABLE / OUT columns.
  const modes = fn.arg_modes ?? fn.all_arg_types.map(() => "i");
  const names = fn.arg_names ?? [];
  const inputs = fn.all_arg_types
    .map((type, i) => ({ type, name: names[i] ?? `arg${i}`, mode: modes[i] }))
    .filter((a) => a.mode === "i" || a.mode === "b" || a.mode === "v");
  const outputs = fn.all_arg_types
    .map((type, i) => ({ type, name: names[i] ?? `col${i}`, mode: modes[i] }))
    .filter((a) => a.mode === "t" || a.mode === "o" || a.mode === "b");
  return { ...fn, inputs, outputs };
});

function tsType(udt: string, dataType: string): string {
  if (dataType === "ARRAY") return `${tsType(udt.replace(/^_/, ""), "")}[]`;
  if (enumNames.has(udt)) return `Database["public"]["Enums"]["${udt}"]`;
  switch (udt) {
    case "int2":
    case "int4":
    case "int8":
    case "float4":
    case "float8":
    case "numeric":
      return "number";
    case "bool":
      return "boolean";
    case "json":
    case "jsonb":
      return "Json";
    default:
      return "string";
  }
}

function formatTypeToTs(type: string): string {
  const base = type.replace(/^public\./, "");
  if (base.endsWith("[]")) return `${formatTypeToTs(base.slice(0, -2))}[]`;
  if (enumNames.has(base)) return `Database["public"]["Enums"]["${base}"]`;
  if (tables.includes(base)) return `Database["public"]["Tables"]["${base}"]["Row"]`;
  const map: Record<string, string> = {
    integer: "number",
    bigint: "number",
    smallint: "number",
    numeric: "number",
    boolean: "boolean",
    json: "Json",
    jsonb: "Json",
    void: "undefined",
  };
  return map[base] ?? "string";
}

const lines: string[] = [];
const out = (s = "") => lines.push(s);

out("// GENERATED by scripts/generate-db-types.ts from supabase/migrations — do not edit.");
out("// Regenerate with `npm run db:types` after changing a migration.");
out();
out("export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];");
out();
out("export type Database = {");
out('  __InternalSupabase: { PostgrestVersion: "13" };');
out("  public: {");
out("    Tables: {");
for (const table of tables) {
  const cols = columns.filter((c) => c.table_name === table);
  out(`      ${table}: {`);
  for (const kind of ["Row", "Insert", "Update"] as const) {
    out(`        ${kind}: {`);
    for (const c of cols) {
      const t = tsType(c.udt_name, c.data_type) + (c.is_nullable === "YES" ? " | null" : "");
      const generated = c.is_generated === "ALWAYS" || c.identity_generation === "ALWAYS";
      if (kind === "Row") out(`          ${c.column_name}: ${t};`);
      else if (generated) out(`          ${c.column_name}?: never;`);
      else {
        const optional = kind === "Update" || c.is_nullable === "YES" || c.column_default !== null || c.is_identity === "YES";
        out(`          ${c.column_name}${optional ? "?" : ""}: ${t};`);
      }
    }
    out("        };");
  }
  const rels = fks.filter((f) => f.table_name === table);
  out("        Relationships: [");
  for (const f of rels) {
    out("          {");
    out(`            foreignKeyName: "${f.name}";`);
    out(`            columns: [${f.columns.map((c) => `"${c}"`).join(", ")}];`);
    out(`            isOneToOne: ${f.one_to_one};`);
    out(`            referencedRelation: "${f.ref_table}";`);
    out(`            referencedColumns: [${f.ref_columns.map((c) => `"${c}"`).join(", ")}];`);
    out("          },");
  }
  out("        ];");
  out("      };");
}
out("    };");
out("    Views: { [_ in never]: never };");
out("    Functions: {");
for (const fn of functions) {
  const firstOptional = fn.inputs.length - fn.arg_defaults;
  const args = fn.inputs.map((a, i) => `${a.name}${i >= firstOptional ? "?" : ""}: ${formatTypeToTs(a.type)}`);
  const rowType =
    fn.outputs.length > 0
      ? `{ ${fn.outputs.map((o) => `${o.name}: ${formatTypeToTs(o.type)}`).join("; ")} }`
      : formatTypeToTs(fn.return_type);
  const returns = rowType + (fn.returns_set ? "[]" : "");
  out(`      ${fn.name}: {`);
  out(`        Args: ${args.length ? `{ ${args.join("; ")} }` : "never"};`);
  out(`        Returns: ${returns};`);
  out("      };");
}
out("    };");
out("    Enums: {");
for (const e of enums) {
  out(`      ${e.name}: ${e.labels.map((l) => `"${l}"`).join(" | ")};`);
}
out("    };");
out("    CompositeTypes: { [_ in never]: never };");
out("  };");
out("};");
out();
out('type PublicSchema = Database["public"];');
out('export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];');
out('export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"];');
out('export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"];');
out('export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];');
out();
out("export const Constants = {");
out("  public: {");
out("    Enums: {");
for (const e of enums) out(`      ${e.name}: [${e.labels.map((l) => `"${l}"`).join(", ")}],`);
out("    },");
out("  },");
out("} as const;");

writeFileSync(OUT, `${lines.join("\n")}\n`);
await db.close();
console.log(`wrote ${path.relative(process.cwd(), OUT)} (${tables.length} tables, ${functions.length} functions, ${enums.length} enums)`);
