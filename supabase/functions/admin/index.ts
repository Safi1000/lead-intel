import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

const ASSIGNABLE = ["manager", "lead_generator", "setter", "closer"];

// Effective permission: SA all-access, then per-user overrides, then role default.
// Mirrors public.has_perm() / src/config/permissions.ts.
function hasPerm(profile: any, key: string): boolean {
  if (profile.role === "superadmin" || profile.role === "admin") return true;
  const perms = profile.permissions ?? { granted: [], denied: [] };
  if (Array.isArray(perms.denied) && perms.denied.includes(key)) return false;
  if (Array.isArray(perms.granted) && perms.granted.includes(key)) return true;
  if (key === "users:manage" || key === "users:view") return profile.role === "manager";
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    if (!token) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);

    const { data: caller } = await admin.from("profiles").select("*").eq("id", userData.user.id).single();
    if (!caller || caller.status !== "active") return json({ error: "Forbidden" }, 403);
    const isSA = caller.role === "superadmin" || caller.role === "admin";
    // org delete is SA-only; everything else requires the users:manage permission.
    const canManageUsers = hasPerm(caller, "users:manage");

    const body = await req.json();
    const action = body.action as string;

    if (!isSA && !canManageUsers && action !== "delete_org") return json({ error: "You do not have permission to manage users." }, 403);

    const loadTarget = async (id: string) => (await admin.from("profiles").select("*").eq("id", id).single()).data;
    // Non-SA actors are scoped to their own org and can never touch a super admin.
    const canManage = (t: any) => !!t && t.role !== "superadmin" && t.role !== "admin" && (isSA || t.org_id === caller.org_id);

    if (action === "create_user") {
      const { name, email, password, role, org_id, permissions } = body;
      if (!ASSIGNABLE.includes(role)) return json({ error: "You cannot assign that role." }, 422);
      const targetOrg = isSA ? org_id : caller.org_id;
      if (!targetOrg) return json({ error: "Select an organization for this user." }, 422);
      if (!password || password.length < 6) return json({ error: "Password must be at least 6 characters." }, 422);
      const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (cErr || !created.user) return json({ error: cErr?.message ?? "Could not create user." }, 422);
      const { error: pErr } = await admin.from("profiles").insert({
        id: created.user.id, name, email, role, org_id: targetOrg,
        permissions: permissions ?? { granted: [], denied: [] }, created_by: caller.name,
      });
      if (pErr) { await admin.auth.admin.deleteUser(created.user.id); return json({ error: pErr.message }, 422); }
      return json({ ok: true, id: created.user.id });
    }

    if (action === "update_user") {
      const target = await loadTarget(body.id);
      if (!canManage(target)) return json({ error: "Not authorized to edit this user." }, 403);
      const patch: Record<string, unknown> = {};
      if (body.name !== undefined) patch.name = body.name;
      if (body.role !== undefined) { if (!ASSIGNABLE.includes(body.role)) return json({ error: "You cannot assign that role." }, 422); patch.role = body.role; }
      if (body.permissions !== undefined) patch.permissions = body.permissions;
      if (body.status !== undefined) patch.status = body.status;
      if (Object.keys(patch).length) await admin.from("profiles").update(patch).eq("id", body.id);
      if (body.status !== undefined) await admin.auth.admin.updateUserById(body.id, { ban_duration: body.status === "disabled" ? "876000h" : "none" });
      return json({ ok: true });
    }

    if (action === "reset_password") {
      const target = await loadTarget(body.id);
      if (!canManage(target)) return json({ error: "Not authorized." }, 403);
      if (!body.password || body.password.length < 6) return json({ error: "Password must be at least 6 characters." }, 422);
      await admin.auth.admin.updateUserById(body.id, { password: body.password });
      return json({ ok: true });
    }

    if (action === "delete_user") {
      const target = await loadTarget(body.id);
      if (!canManage(target)) return json({ error: "Not authorized." }, 403);
      // Release the book BEFORE dropping the auth user. Nothing cascades from
      // auth.users to public.profiles, so deleting the auth user alone used to
      // leave the profile and every lead assignment behind as a ghost holder.
      // Doing the release first means a failure here aborts with the user still
      // intact, rather than stranding leads on a half-deleted account.
      const { data: released, error: relErr } = await admin.rpc("delete_user_and_release_leads", { p_user_id: body.id });
      if (relErr) return json({ error: relErr.message }, 422);
      await admin.auth.admin.deleteUser(body.id);
      return json({ ok: true, ...(released ?? {}) });
    }

    if (action === "delete_org") {
      if (!isSA) return json({ error: "Only the super admin can delete organizations." }, 403);
      const { data: members } = await admin.from("profiles").select("id").eq("org_id", body.id);
      for (const m of members ?? []) await admin.auth.admin.deleteUser(m.id);
      await admin.from("orgs").delete().eq("id", body.id);
      return json({ ok: true });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
