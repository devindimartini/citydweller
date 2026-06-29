// ============================================================
// data.js — all reads/writes to Supabase, one place.
// Each function maps the app's in-memory shapes to DB rows.
// Row-Level Security ensures a user only ever sees their own data,
// so we never filter by user_id here — the DB enforces it.
// ============================================================
import { supabase } from "./supabaseClient";

// ---------- LOAD everything for the logged-in user ----------
export async function loadAll() {
  const [items, transit, events, notebooks, entries, pinCats, pathCats] = await Promise.all([
    supabase.from("items").select("*"),
    supabase.from("transit_stops").select("*"),
    supabase.from("events").select("*"),
    supabase.from("notebooks").select("*"),
    supabase.from("notebook_entries").select("*"),
    supabase.from("pin_categories").select("*").order("sort"),
    supabase.from("path_categories").select("*").order("sort"),
  ]);
  const firstErr = [items, transit, events, notebooks, entries, pinCats, pathCats].find((r) => r.error);
  if (firstErr) throw firstErr.error;

  return {
    items: (items.data || []).map(rowToItem),
    transit: (transit.data || []).map(rowToTransit),
    events: (events.data || []).map(rowToEvent),
    notebooks: assembleNotebooks(notebooks.data || [], entries.data || []),
    categories: (pinCats.data || []).map((c) => ({ name: c.name, icon: c.icon })),
    pathCategories: (pathCats.data || []).map((c) => ({ name: c.name, icon: c.icon, color: c.color })),
  };
}

// ---------- mappers: DB row <-> app shape ----------
function rowToItem(r) {
  return {
    id: r.id, kind: r.kind, shapeType: r.shape_type || undefined,
    status: r.status, category: r.category,
    title: r.title, description: r.description, note: r.note,
    date: r.date || "", city: r.city || "",
    lat: r.lat, lng: r.lng, path: r.path || undefined,
    media: r.media || [], hidden: r.hidden, favorite: r.favorite,
  };
}
function itemToRow(it, userId) {
  return {
    id: it.id, user_id: userId, kind: it.kind, shape_type: it.shapeType || null,
    status: it.status, category: it.category,
    title: it.title || "", description: it.description || "", note: it.note || "",
    date: it.date || "", city: it.city || "",
    lat: it.lat ?? null, lng: it.lng ?? null, path: it.path || null,
    media: it.media || [], hidden: !!it.hidden, favorite: !!it.favorite,
    updated_at: new Date().toISOString(),
  };
}
function rowToTransit(r) {
  return { id: r.id, name: r.name, line: r.line, type: r.type, color: r.color, lat: r.lat, lng: r.lng };
}
function transitToRow(t, userId) {
  return { id: t.id, user_id: userId, name: t.name || "", line: t.line || "", type: t.type || "rail", color: t.color || "#2C6FB7", lat: t.lat ?? null, lng: t.lng ?? null };
}
function rowToEvent(r) {
  return {
    id: r.id, title: r.title, venue: r.venue, lat: r.lat, lng: r.lng,
    allDay: r.all_day, mode: r.mode, datetime: r.datetime || "",
    startDate: r.start_date || "", endDate: r.end_date || "",
    dates: r.dates || [], media: r.media || [],
  };
}
function eventToRow(e, userId) {
  return {
    id: e.id, user_id: userId, title: e.title || "", venue: e.venue || "",
    lat: e.lat ?? null, lng: e.lng ?? null, all_day: !!e.allDay, mode: e.mode || "single",
    datetime: e.datetime || "", start_date: e.startDate || "", end_date: e.endDate || "",
    dates: e.dates || [], media: e.media || [],
  };
}
function assembleNotebooks(nbRows, entryRows) {
  return nbRows.map((n) => ({
    id: n.id, title: n.title, description: n.description,
    entries: entryRows
      .filter((e) => e.notebook_id === n.id)
      .sort((a, b) => a.sort - b.sort)
      .map((e) => ({ pinId: e.item_id, caption: e.caption })),
  }));
}

// ---------- SAVE helpers (upsert = insert or update) ----------
export async function saveItem(it, userId) {
  const { error } = await supabase.from("items").upsert(itemToRow(it, userId));
  if (error) throw error;
}
export async function deleteItem(id) {
  const { error } = await supabase.from("items").delete().eq("id", id);
  if (error) throw error;
}
export async function saveTransit(t, userId) {
  const { error } = await supabase.from("transit_stops").upsert(transitToRow(t, userId));
  if (error) throw error;
}
export async function deleteTransit(id) {
  const { error } = await supabase.from("transit_stops").delete().eq("id", id);
  if (error) throw error;
}
export async function saveEvent(e, userId) {
  const { error } = await supabase.from("events").upsert(eventToRow(e, userId));
  if (error) throw error;
}
export async function deleteEvent(id) {
  const { error } = await supabase.from("events").delete().eq("id", id);
  if (error) throw error;
}

// ---------- categories ----------
export async function savePinCategories(cats, userId) {
  // replace the user's whole set (simple + reliable for small lists)
  await supabase.from("pin_categories").delete().neq("name", "___none___");
  const rows = cats.map((c, i) => ({ user_id: userId, name: c.name, icon: c.icon, sort: i }));
  const { error } = await supabase.from("pin_categories").insert(rows);
  if (error) throw error;
}
export async function savePathCategories(cats, userId) {
  await supabase.from("path_categories").delete().neq("name", "___none___");
  const rows = cats.map((c, i) => ({ user_id: userId, name: c.name, icon: c.icon, color: c.color, sort: i }));
  const { error } = await supabase.from("path_categories").insert(rows);
  if (error) throw error;
}

// ---------- notebooks ----------
export async function saveNotebook(nb, userId) {
  const { error } = await supabase.from("notebooks").upsert({
    id: nb.id, user_id: userId, title: nb.title || "", description: nb.description || "",
  });
  if (error) throw error;
  // rewrite this notebook's entries
  await supabase.from("notebook_entries").delete().eq("notebook_id", nb.id);
  if (nb.entries && nb.entries.length) {
    const rows = nb.entries.map((e, i) => ({ notebook_id: nb.id, item_id: e.pinId, caption: e.caption || "", sort: i }));
    const { error: e2 } = await supabase.from("notebook_entries").insert(rows);
    if (e2) throw e2;
  }
}
export async function deleteNotebook(id) {
  const { error } = await supabase.from("notebooks").delete().eq("id", id);
  if (error) throw error;
}

// ---------- photo/video upload to Storage ----------
export async function uploadMedia(file, userId) {
  const ext = (file.name.split(".").pop() || "bin").toLowerCase();
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabase.storage.from("media").upload(path, file, { upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from("media").getPublicUrl(path);
  return { id: path, type: file.type.startsWith("video") ? "video" : "image", name: file.name, url: data.publicUrl };
}
