import React, { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "./supabaseClient";
import { loadAll, saveItem, deleteItem as dbDeleteItem, saveTransit, deleteTransit as dbDeleteTransit, saveEvent, deleteEvent as dbDeleteEvent, saveNotebook, deleteNotebook as dbDeleteNotebook, savePinCategories, savePathCategories } from "./data";

/*
  CityDweller — local v3
  ----------------------
  A personal map journal. View-first: the map opens in read mode. Use
  "Add pin" / "Add line" to create. Items open in a reading view with an
  Edit button; new items open straight into the editable form with Save.
  Each item can be hidden from the map individually from its reading view.

  What's new vs v2:
    - Map defaults to VIEW mode. Clicking the map does nothing (deselects).
    - "Add pin" and "Add line" buttons start creation; after placing, the
      app returns to view mode.
    - New pin/line opens the editor (edit state) with a Save button. Title
      is required to save. Delete is available to discard an unwanted new one.
    - Clicking an existing item opens a READING view (read-only) with an
      Edit button at the bottom.
    - Per-item hide/show toggle lives in each item's reading view. The old
      master Pins/Lines toggles are gone.

  Draw line is freehand: press-hold-drag (mouse or finger), release to finish.

  City auto-fills from the pin's location when a geocoder is available (see
  reverseGeocode). The sandbox can't call out, so it's manual here; in your
  real Google Maps build, wire reverseGeocode to the Geocoder.

  MAP ENGINE NOTE: Leaflet + OpenStreetMap, a drop-in for Google Maps.
  Data persists only in React state for this session.
*/


const STATUS = { VISITED: "visited", WISHLIST: "wishlist" };
const DEFAULT_CATEGORIES = [
  { name: "restaurant", icon: "🍴" },
  { name: "cafe", icon: "☕" },
  { name: "library", icon: "📚" },
  { name: "leisure", icon: "🎡" },
  { name: "bar", icon: "🍸" },
  { name: "shop", icon: "🛍️" },
  { name: "park", icon: "🌳" },
  { name: "scenic", icon: "🏞️" },
  { name: "activity", icon: "🤸" },
  { name: "culture", icon: "🏛️" },
  { name: "mixed space", icon: "🏢" },
  { name: "other", icon: "📍" },
];
const catLabel = (c) => (c || "").charAt(0).toUpperCase() + (c || "").slice(1);

// curated emoji palette for category icons
const CATEGORY_ICONS = [
  "📍", "🍴", "☕", "📚", "🎡", "🍸", "🛍️", "🌳", "🛏️", "🍕", "🍜", "🍣",
  "🍦", "🥐", "🍷", "🎬", "🎨", "🎵", "🏛️", "⛪", "🕌", "🛕", "🏖️", "🏔️",
  "🎢", "🏟️", "💪", "🧘", "🏊", "⚽", "🎾", "🎳", "🎮", "📷", "🌸", "🐾",
  "🚗", "✈️", "⛵", "🏥", "💊", "💈", "🏦", "⛽", "🅿️", "🎁", "💍", "🏠",
  "🚶", "🚴", "🏃", "🥾", "🛒", "🏞️", "🧭", "🗺️",
];

// path categories: their own set, each with icon + color
const DEFAULT_PATH_CATEGORIES = [
  { name: "walk", icon: "🚶", color: "#1D9E75" },
  { name: "bike path", icon: "🚴", color: "#2C6FB7" },
  { name: "run", icon: "🏃", color: "#D85A30" },
  { name: "hike", icon: "🥾", color: "#7A4FB5" },
  { name: "drive", icon: "🚗", color: "#C0392B" },
  { name: "shopping", icon: "🛒", color: "#D85A9C" },
  { name: "scenic route", icon: "🏞️", color: "#138D8D" },
  { name: "other", icon: "🧭", color: "#534AB7" },
];
// palette of colors users can pick for a path category
const PATH_CATEGORY_COLORS = ["#1D9E75", "#2C6FB7", "#D85A30", "#7A4FB5", "#C0392B", "#D85A9C", "#138D8D", "#534AB7", "#E0A21C", "#5F5E5A"];

// look up a category's icon by its name from a categories array
function iconFor(categories, name) {
  const c = categories.find((x) => x.name === name);
  return c ? c.icon : "📍";
}

// transit stop types
const TRANSIT_TYPES = [
  { id: "rail", label: "Rail", icon: "🚆" },
  { id: "jeepney", label: "Jeepney", icon: "🚙" },
  { id: "bus", label: "Bus", icon: "🚌" },
  { id: "ferry", label: "Ferry", icon: "⛴️" },
];
const transitType = (id) => TRANSIT_TYPES.find((t) => t.id === id) || TRANSIT_TYPES[0];

// Common Manila rail line colors (preset palette)
const TRANSIT_COLORS = [
  { name: "LRT-1 Green", color: "#1E8C45" },
  { name: "LRT-2 Blue", color: "#2C6FB7" },
  { name: "MRT-3 Yellow", color: "#E0A21C" },
  { name: "MRT-7 Red", color: "#C0392B" },
  { name: "PNR Orange", color: "#E07B1C" },
  { name: "Purple", color: "#7A4FB5" },
  { name: "Teal", color: "#138D8D" },
  { name: "Pink", color: "#D85A9C" },
];

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

// distance in km between two lat/lng points (haversine)
function distanceKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// reference coordinate for an item (pin = its point; line = its first point)
function itemCoord(it) {
  if (it.kind === "pin") return { lat: it.lat, lng: it.lng };
  if (it.path && it.path.length) return { lat: it.path[0][0], lng: it.path[0][1] };
  return null;
}

function formatKm(km) {
  if (km == null) return "";
  if (km < 1) return `${Math.round(km * 1000)} m away`;
  if (km < 10) return `${km.toFixed(1)} km away`;
  return `${Math.round(km)} km away`;
}

// Build the small preview-card HTML shown under a marker on hover/tap.
function previewHTML({ title, meta, note, thumb, dist, accent }) {
  const safe = (x) => (x || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const img = thumb ? `<div style="width:100%;height:84px;border-radius:8px 8px 0 0;overflow:hidden;background:#eee;"><img src="${thumb}" style="width:100%;height:100%;object-fit:cover;display:block;"/></div>` : "";
  const distLine = dist ? `<div style="font-size:11px;color:#185FA5;font-weight:600;margin-top:2px;">${safe(dist)}</div>` : "";
  const noteLine = note ? `<div style="font-size:12px;color:#3A3A38;margin-top:4px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;">${safe(note)}</div>` : "";
  return `
    <div style="width:190px;font-family:system-ui,sans-serif;">
      ${img}
      <div style="padding:${thumb ? "8px 10px 10px" : "10px"};">
        <div style="font-size:14px;font-weight:700;color:#2C2C2A;line-height:1.2;">${safe(title) || "Untitled"}</div>
        ${meta ? `<div style="font-size:12px;color:#5F5E5A;margin-top:2px;">${safe(meta)}</div>` : ""}
        ${distLine}
        ${noteLine}
        <div style="font-size:11.5px;color:${accent || "#1D9E75"};font-weight:600;margin-top:6px;">Tap to open →</div>
      </div>
    </div>`;
}

const LEAFLET_CSS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
const LEAFLET_JS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
function loadLeaflet() {
  return new Promise((resolve, reject) => {
    if (window.L) return resolve(window.L);
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = LEAFLET_CSS;
      document.head.appendChild(link);
    }
    if (!document.getElementById("cd-preview-css")) {
      const st = document.createElement("style");
      st.id = "cd-preview-css";
      st.textContent = ".cd-preview-popup .leaflet-popup-content{margin:0!important;width:190px!important;}.cd-preview-popup .leaflet-popup-content-wrapper{padding:0!important;overflow:hidden;border-radius:10px;}";
      document.head.appendChild(st);
    }
    const existing = document.querySelector(`script[src="${LEAFLET_JS}"]`);
    if (existing) {
      if (window.L) return resolve(window.L);
      existing.addEventListener("load", () => resolve(window.L));
      existing.addEventListener("error", reject);
      return;
    }
    const s = document.createElement("script");
    s.src = LEAFLET_JS;
    s.async = true;
    s.onload = () => resolve(window.L);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

/* Replace with a real geocoder call in your deployment. */
function reverseGeocode(/* lat, lng */) {
  return Promise.resolve("");
}

/*
  searchPlaces(query) -> Promise<Array<{ name, address, lat, lng }>>
  Turns a search string into a list of matching places. Needs an external
  geocoding/places service, which the sandbox blocks — so it returns [] here.
  In your real app, replace the body with a call to the Google Places API
  (Autocomplete + Place Details) or the Geocoding API and map the results
  to { name, address, lat, lng }.
*/
function searchPlaces(/* query */) {
  return Promise.resolve([]);
}

/*
  fetchPlaceDetails({lat, lng, title}) -> Promise<{rating, totalRatings, reviews:[{author,text,rating}], photos:[url]} | null>
  Returns Google listing data for a location. Needs the Google Places API
  (Place Search to resolve the place, then Place Details) plus your API key
  and billing, and must follow Google's display rules. The sandbox can't
  call it, so it returns null. In your cloud build, implement this against
  the Places API and render the result in your own styled section.
*/
function fetchPlaceDetails(/* {lat, lng, title} */) {
  return Promise.resolve(null);
}

/*
  geocodeAddress(address) -> Promise<{lat, lng} | null>
  Turns a typed address/venue into coordinates. Needs the Geocoding API and
  your key; the sandbox can't call it, so it returns null and the caller
  falls back to the map center / current location. Wire to Google's
  Geocoder in your cloud build.
*/
function geocodeAddress(/* address */) {
  return Promise.resolve(null);
}

// Collect the relevant date instances from an event into {start, end} windows.
function eventWindows(ev) {
  const windows = [];
  const endOfDay = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x.getTime(); };
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
  if (!ev) return windows;
  if (ev.mode === "range" && ev.startDate && ev.endDate) {
    const s = ev.allDay ? startOfDay(ev.startDate) : new Date(ev.startDate).getTime();
    const e = ev.allDay ? endOfDay(ev.endDate) : new Date(ev.endDate).getTime();
    windows.push({ start: s, end: e });
  } else if (ev.mode === "multi" && Array.isArray(ev.dates)) {
    ev.dates.filter(Boolean).forEach((d) => {
      const s = ev.allDay ? startOfDay(d) : new Date(d).getTime();
      const e = ev.allDay ? endOfDay(d) : new Date(d).getTime();
      windows.push({ start: s, end: e });
    });
  } else if (ev.datetime) {
    const s = ev.allDay ? startOfDay(ev.datetime) : new Date(ev.datetime).getTime();
    const e = ev.allDay ? endOfDay(ev.datetime) : new Date(ev.datetime).getTime();
    windows.push({ start: s, end: e });
  }
  return windows.sort((a, b) => a.start - b.start);
}

// countdown for an event. Returns {text, past, ongoing}
function countdown(ev) {
  // backward-compat: allow passing a raw date string
  if (typeof ev === "string") ev = { datetime: ev };
  const wins = eventWindows(ev);
  if (wins.length === 0) return { text: "", past: false, ongoing: false };
  const now = Date.now();
  // ongoing?
  const live = wins.find((w) => now >= w.start && now <= w.end);
  if (live) return { text: "Ongoing", past: false, ongoing: true };
  // next upcoming
  const next = wins.find((w) => w.start > now);
  if (!next) return { text: "Past", past: true, ongoing: false };
  const diff = next.start - now;
  const mins = Math.floor(diff / 60000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (days > 0) return { text: `${days}d ${hours}h`, past: false, ongoing: false };
  if (hours > 0) return { text: `${hours}h ${m}m`, past: false, ongoing: false };
  return { text: `${m}m`, past: false, ongoing: false };
}

// soonest relevant timestamp for sorting (next upcoming or ongoing start)
function eventSortKey(ev) {
  const wins = eventWindows(ev);
  if (wins.length === 0) return Infinity;
  const now = Date.now();
  const live = wins.find((w) => now >= w.start && now <= w.end);
  if (live) return now; // ongoing sorts to top
  const next = wins.find((w) => w.start > now);
  return next ? next.start : Infinity;
}
function eventHasUpcoming(ev) {
  const wins = eventWindows(ev);
  const now = Date.now();
  return wins.some((w) => w.end >= now);
}

// human-readable date summary for an event
function eventDateSummary(ev) {
  if (!ev) return "";
  const dOpt = ev.allDay ? { dateStyle: "medium" } : { dateStyle: "medium", timeStyle: "short" };
  const fmt = (d) => { try { return new Date(d).toLocaleString([], dOpt); } catch { return ""; } };
  if (ev.mode === "range" && ev.startDate && ev.endDate) return `${fmt(ev.startDate)} – ${fmt(ev.endDate)}`;
  if (ev.mode === "multi" && Array.isArray(ev.dates) && ev.dates.filter(Boolean).length) {
    const ds = ev.dates.filter(Boolean);
    return ds.length === 1 ? fmt(ds[0]) : `${fmt(ds[0])} +${ds.length - 1} more`;
  }
  if (ev.datetime) return fmt(ev.datetime);
  return "";
}

// Google Maps deep link for a coordinate (opens the listing/area in Google Maps)
function googleMapsUrl(lat, lng, label) {
  const q = label ? encodeURIComponent(label) : `${lat},${lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${q}&query_place_id=`;
}

const C = {
  visited: "#913B09",
  wishlist: "#D85A30",
  shape: "#53B093",
  pinVisited: "#2FA353",
  pinWishlist: "#1C1C1C",
  bg: "#F1EFE8",
  card: "#ffffff",
  border: "#D3D1C7",
  text: "#2C2C2A",
  sub: "#5F5E5A",
};

export default function CityDweller({ user, signOut }) {
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const userId = user?.id;
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const LRef = useRef(null);
  const layersRef = useRef({});
  const freehand = useRef({ drawing: false, pts: [], poly: null });

  const [ready, setReady] = useState(false);
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

  // panel: which item is open, and whether we're reading or editing
  const [panelId, setPanelId] = useState(null);
  const [panelMode, setPanelMode] = useState("read"); // "read" | "edit"
  const editSnapshot = useRef(null);   // snapshot of item when edit began
  const editIsNew = useRef(false);     // was this item brand-new (discard => delete)
  const [editDirty, setEditDirty] = useState(false);
  const editDirtyRef = useRef(false);
  const panelModeRef = useRef("read");
  useEffect(() => { editDirtyRef.current = editDirty; }, [editDirty]);
  useEffect(() => { panelModeRef.current = panelMode; }, [panelMode]);
  const [pendingNav, setPendingNav] = useState(null); // queued navigation action awaiting save/discard
  const [unsavedOpen, setUnsavedOpen] = useState(false);

  const [view, setView] = useState("map");
  // map interaction mode: "view" | "addPin" | "addLine"
  const [mapMode, setMapMode] = useState("view");

  // notebooks
  const [notebooks, setNotebooks] = useState([]); // {id, title, description, entries:[{pinId, caption}]}
  const [listMode, setListMode] = useState("places"); // "places" | "favorites" | "notebooks"
  const [listSearchOpen, setListSearchOpen] = useState(false);
  const [listSearch, setListSearch] = useState("");
  const [openNotebookId, setOpenNotebookId] = useState(null);
  const [addToNotebookFor, setAddToNotebookFor] = useState(null); // pinId being added to a notebook
  const [didYouGoFor, setDidYouGoFor] = useState(null); // item id in the "did you go?" flow
  const promptedWentRef = useRef(new Set()); // ids we've auto-prompted this session

  const [cityFilter, setCityFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusPill, setStatusPill] = useState("all");

  // search
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState(null); // null = idle, [] = no matches
  const [searching, setSearching] = useState(false);
  const [snapMsg, setSnapMsg] = useState("");
  const [mapCats, setMapCats] = useState(() => new Set(DEFAULT_CATEGORIES.map((c) => c.name))); // category names shown on map
  const [catMenuOpen, setCatMenuOpen] = useState(false);
  const [pinsAccordionOpen, setPinsAccordionOpen] = useState(true);
  const [pathsAccordionOpen, setPathsAccordionOpen] = useState(false);
  const [categories, setCategories] = useState([]);
  const [manageCatsOpen, setManageCatsOpen] = useState(false);
  const [pathCategories, setPathCategories] = useState([]);
  const [managePathCatsOpen, setManagePathCatsOpen] = useState(false);
  const [mapPathCats, setMapPathCats] = useState(() => new Set(DEFAULT_PATH_CATEGORIES.map((c) => c.name)));
  const [showLinesOnMap, setShowLinesOnMap] = useState(true);

  // events
  const [events, setEvents] = useState([]); // {id,title,venue,lat,lng,datetime,media:[]}
  const [eventPanelId, setEventPanelId] = useState(null); // open event editor
  const [addingEvent, setAddingEvent] = useState(false); // event create flow

  // transit stops (standalone points, grouped by line label/color; no drawn line)
  const [transit, setTransit] = useState([]); // {id,name,line,color,lat,lng}
  const [transitPanelId, setTransitPanelId] = useState(null);
  const [showTransitOnMap, setShowTransitOnMap] = useState(true);
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNowTick((n) => n + 1), 30000); // refresh countdowns
    return () => clearInterval(t);
  }, []);
  const [following, setFollowing] = useState(false);
  const [userPos, setUserPos] = useState(null); // {lat,lng} live position
  const hereMarker = useRef(null);
  const watchId = useRef(null);
  const followingRef = useRef(false);
  const userPosRef = useRef(null);

  // ---------- LOAD all data from Supabase on login ----------
  useEffect(() => {
    let on = true;
    if (!userId) return;
    setLoaded(false);
    setLoadError("");

    async function attempt(triesLeft) {
      // make sure the session/token is actually restored before querying,
      // otherwise a cold refresh races and RLS returns 403 on every table
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        if (triesLeft > 0) { setTimeout(() => on && attempt(triesLeft - 1), 250); return; }
        throw new Error("Your session isn't ready yet. Try refreshing.");
      }
      const d = await loadAll();
      if (!on) return;
      setItems(d.items);
      setTransit(d.transit);
      setEvents(d.events);
      setNotebooks(d.notebooks);
      setCategories(d.categories.length ? d.categories : DEFAULT_CATEGORIES);
      setPathCategories(d.pathCategories.length ? d.pathCategories : DEFAULT_PATH_CATEGORIES);
      setMapCats(new Set((d.categories.length ? d.categories : DEFAULT_CATEGORIES).map((c) => c.name)));
      setMapPathCats(new Set((d.pathCategories.length ? d.pathCategories : DEFAULT_PATH_CATEGORIES).map((c) => c.name)));
      setLoaded(true);
    }

    attempt(8).catch((e) => { if (on) { setLoadError(e.message || "Failed to load your data."); setLoaded(true); } });
    return () => { on = false; };
  }, [userId]);

  // ---------- persistence helpers (save-on-action) ----------
  // Pass 1: media stays in-session only. Strip base64 blobs before saving so
  // the database isn't bloated; real photo upload arrives in Pass 2.
  const stripMedia = (it) => ({ ...it, media: (it.media || []).filter((m) => m.url && !String(m.url).startsWith("data:")) });
  const persistItem = useCallback((it) => { if (userId) saveItem(stripMedia(it), userId).catch((e) => console.error("save item", e)); }, [userId]);
  const persistTransit = useCallback((t) => { if (userId) saveTransit(t, userId).catch((e) => console.error("save transit", e)); }, [userId]);
  const persistEvent = useCallback((e2) => { if (userId) saveEvent({ ...e2, media: (e2.media || []).filter((m) => m.url && !String(m.url).startsWith("data:")) }, userId).catch((e) => console.error("save event", e)); }, [userId]);
  const persistNotebook = useCallback((nb) => { if (userId) saveNotebook(nb, userId).catch((e) => console.error("save notebook", e)); }, [userId]);
  const persistPinCats = useCallback((cats) => { if (userId) savePinCategories(cats, userId).catch((e) => console.error("save pin cats", e)); }, [userId]);
  const persistPathCats = useCallback((cats) => { if (userId) savePathCategories(cats, userId).catch((e) => console.error("save path cats", e)); }, [userId]);
  useEffect(() => { userPosRef.current = userPos; }, [userPos]);
  const baseLayersRef = useRef(null);
  const [mapView, setMapView] = useState("street");
  function switchMapView(v) {
    const map = mapRef.current, layers = baseLayersRef.current;
    if (!map || !layers) return;
    Object.values(layers).forEach((l) => { if (map.hasLayer(l)) map.removeLayer(l); });
    layers[v].addTo(map);
    // keep base tiles under everything else
    layers[v].bringToBack();
    setMapView(v);
  }
  const snapInputRef = useRef(null);
  const pendingSnap = useRef(null); // holds the captured file while we get location

  const mapModeRef = useRef(mapMode);
  useEffect(() => { mapModeRef.current = mapMode; }, [mapMode]);

  // ---------- map init ----------
  useEffect(() => {
    if (!loaded) return; // wait until past the loading screen so the map div is rendered
    let cancelled = false;
    function init(triesLeft) {
      loadLeaflet().then((L) => {
        if (cancelled || mapRef.current) return;
        if (!mapEl.current) {
          if (triesLeft > 0) { setTimeout(() => init(triesLeft - 1), 100); return; }
          console.error("MAP INIT: container never appeared"); setReady(false); return;
        }
        LRef.current = L;
        const map = L.map(mapEl.current, { zoomControl: false }).setView([14.5764, 121.0851], 12);
        L.control.zoom({ position: "bottomright" }).addTo(map);
      const baseLayers = {
        street: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap contributors", maxZoom: 19 }),
        satellite: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { attribution: "© Esri", maxZoom: 19 }),
        terrain: L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", { attribution: "© OpenTopoMap", maxZoom: 17 }),
      };
      baseLayersRef.current = baseLayers;
      baseLayers.street.addTo(map);
      mapRef.current = map;

      map.on("click", (e) => {
        const mode = mapModeRef.current;
        if (mode === "addPin") {
          placePin(e.latlng);
        } else if (mode === "addTransit") {
          placeTransitStop(e.latlng);
        } else if (mode === "view") {
          // deselect and close any open reading panel when tapping empty map
          guardNav(() => { setSelectedId(null); setPanelId(null); });
        }
      });

      // freehand line drawing
      const c = map.getContainer();
      const toLatLng = (ev) => {
        const t = ev.touches ? ev.touches[0] : ev;
        const r = c.getBoundingClientRect();
        return map.containerPointToLatLng([t.clientX - r.left, t.clientY - r.top]);
      };
      const down = (ev) => {
        if (mapModeRef.current !== "addLine") return;
        ev.preventDefault();
        const fh = freehand.current;
        fh.drawing = true;
        fh.pts = [toLatLng(ev)];
        if (fh.poly) fh.poly.remove();
        fh.poly = L.polyline(fh.pts, { color: C.shape, weight: 4 }).addTo(map);
      };
      const move = (ev) => {
        const fh = freehand.current;
        if (mapModeRef.current !== "addLine" || !fh.drawing) return;
        ev.preventDefault();
        fh.pts.push(toLatLng(ev));
        fh.poly.setLatLngs(fh.pts);
      };
      const up = () => {
        const fh = freehand.current;
        if (mapModeRef.current !== "addLine" || !fh.drawing) return;
        fh.drawing = false;
        if (fh.pts.length > 2) {
          const path = fh.pts.map((p) => [p.lat, p.lng]);
          if (fh.poly) fh.poly.remove();
          fh.poly = null;
          placeLine(path);
        } else {
          if (fh.poly) fh.poly.remove();
          fh.poly = null;
        }
      };
      c.addEventListener("mousedown", down);
      c.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      c.addEventListener("touchstart", down, { passive: false });
      c.addEventListener("touchmove", move, { passive: false });
      window.addEventListener("touchend", up);

      setReady(true);
      }).catch((err) => { console.error("MAP INIT FAILED:", err); setReady(false); });
    }
    init(30);
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [loaded]);

  // ---------- creation ----------
  const placePin = useCallback((latlng) => {
    const id = uid();
    const newPin = {
      id, kind: "pin", status: STATUS.VISITED, category: "restaurant",
      title: "", description: "", note: "", date: "", city: "",
      lat: latlng.lat, lng: latlng.lng, media: [], hidden: false, favorite: false,
    };
    setItems((prev) => [...prev, newPin]); persistItem(newPin);
    setSelectedId(id);
    setPanelId(id);
    editSnapshot.current = { ...newPin };
    editIsNew.current = true;
    setEditDirty(false);
    setPanelMode("edit");       // new item opens in edit mode with Save
    setMapMode("view");         // back to view after placing
    reverseGeocode(latlng.lat, latlng.lng).then((city) => {
      if (city) setItems((prev) => prev.map((it) => (it.id === id && !it.city ? { ...it, city } : it)));
    });
  }, []);

  function placeLine(path) {
    const id = uid();
    const shape = {
      id, kind: "shape", shapeType: "line", status: STATUS.WISHLIST, category: "walk",
      title: "", description: "", note: "", date: "", city: "", path, media: [], hidden: false, favorite: false,
    };
    setItems((prev) => [...prev, shape]); persistItem(shape);
    setSelectedId(id);
    setPanelId(id);
    editSnapshot.current = { ...shape };
    editIsNew.current = true;
    setEditDirty(false);
    setPanelMode("edit");
    setMapMode("view");
    setMapCursor("");
  }

  // ---------- map mode helpers ----------
  function setMapCursor(cur) {
    const map = mapRef.current;
    if (map) map.getContainer().style.cursor = cur;
  }
  function enterAddPin() {
    setView("map");
    setMapMode("addPin");
    const map = mapRef.current;
    if (map) { map.dragging.enable(); setMapCursor("crosshair"); }
  }
  function enterAddLine() {
    setView("map");
    setMapMode("addLine");
    const map = mapRef.current;
    if (map) { map.dragging.disable(); setMapCursor("crosshair"); }
  }
  function exitAddMode() {
    setMapMode("view");
    const map = mapRef.current;
    if (map) { map.dragging.enable(); setMapCursor(""); }
    const fh = freehand.current;
    if (fh.poly) { fh.poly.remove(); fh.poly = null; }
    fh.drawing = false; fh.pts = [];
  }

  // ---------- render layers ----------
  useEffect(() => {
    if (!ready) return;
    const L = LRef.current, map = mapRef.current;
    Object.keys(layersRef.current).forEach((id) => {
      if (!items.find((it) => it.id === id)) {
        layersRef.current[id].remove();
        delete layersRef.current[id];
      }
    });

    items.forEach((it) => {
      const existing = layersRef.current[it.id];
      if (existing) existing.remove();

      // per-item hide always wins
      if (it.hidden) { delete layersRef.current[it.id]; return; }
      // pins filter by pin category; paths filter by path category + show toggle
      if (it.kind === "pin" && !mapCats.has(it.category)) { delete layersRef.current[it.id]; return; }
      if (it.kind === "shape" && (!showLinesOnMap || !mapPathCats.has(it.category))) { delete layersRef.current[it.id]; return; }

      let layer;
      const color = it.status === STATUS.VISITED ? C.pinVisited : C.pinWishlist;
      if (it.kind === "pin") {
        layer = L.marker([it.lat, it.lng], { icon: pinIcon(L, color, iconFor(categories, it.category), it.favorite, it.status === STATUS.VISITED) });
      } else {
        layer = L.polyline(it.path, { color: pathCatColor(it.category), weight: 5 });
      }
      const openFull = () => { setSelectedId(it.id); setPanelId(it.id); setPanelMode("read"); };
      const meta = it.kind === "pin" ? `${iconFor(categories, it.category)} ${catLabel(it.category)}` : `${pathCatIcon(it.category)} ${catLabel(it.category)}`;
      const thumb = (it.media || []).find((m) => m.type !== "video");
      const dist = userPosRef.current && itemCoord(it) ? formatKm(distanceKm(userPosRef.current, itemCoord(it))) : "";
      const html = previewHTML({ title: it.title, meta, note: it.description || it.note, thumb: thumb ? thumb.url : "", dist, accent: color });
      layer.bindPopup(html, { offset: it.kind === "pin" ? [0, -38] : [0, 0], closeButton: false, className: "cd-preview-popup" });
      layer.on("click", (e) => {
        if (e.originalEvent) e.originalEvent.stopPropagation();
        if (mapModeRef.current !== "view") return; // ignore selection while adding
        openFull();
      });
      layer.on("mouseover", () => { if (mapModeRef.current === "view") layer.openPopup(); });
      layer.on("mouseout", () => layer.closePopup());
      layer.on("popupopen", (e) => {
        const node = e.popup.getElement();
        if (node) { node.querySelector(".leaflet-popup-content").style.cursor = "pointer"; node.querySelector(".leaflet-popup-content-wrapper").onclick = openFull; }
      });
      layer.addTo(map);
      layersRef.current[it.id] = layer;
    });
  }, [items, ready, mapCats, showLinesOnMap, categories, mapPathCats, pathCategories]);

  // render transit stop markers (standalone, no connecting line)
  const transitLayers = useRef({});
  useEffect(() => {
    if (!ready) return;
    const L = LRef.current, map = mapRef.current;
    Object.keys(transitLayers.current).forEach((id) => {
      transitLayers.current[id].remove();
      delete transitLayers.current[id];
    });
    if (!showTransitOnMap) return;
    transit.forEach((t) => {
      const tt = transitType(t.type);
      const labelText = t.line || tt.label;
      const icon = L.divIcon({
        html: `<div style="display:flex;flex-direction:column;align-items:center;">
          <div style="width:24px;height:24px;border-radius:50%;background:#fff;border:2px solid ${t.color};box-shadow:0 1px 3px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;font-size:13px;">${tt.icon}</div>
          ${labelText ? `<div style="margin-top:3px;background:${t.color};color:#fff;font-size:9px;font-weight:700;padding:1px 5px;border-radius:6px;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,0.3);">${labelText}</div>` : ""}
        </div>`,
        className: "cd-transit", iconSize: [50, 40], iconAnchor: [25, 14], tooltipAnchor: [0, -12],
      });
      const m = L.marker([t.lat, t.lng], { icon });
      const openFull = () => setTransitPanelId(t.id);
      const thumbT = "";
      const distT = userPosRef.current ? formatKm(distanceKm(userPosRef.current, { lat: t.lat, lng: t.lng })) : "";
      m.bindPopup(previewHTML({ title: t.name || labelText, meta: `${tt.icon} ${tt.label}${t.line ? " · " + t.line : ""}`, thumb: thumbT, dist: distT, accent: t.color }), { offset: [0, -14], closeButton: false, className: "cd-preview-popup" });
      m.on("click", (e) => { if (e.originalEvent) e.originalEvent.stopPropagation(); if (mapModeRef.current === "view") openFull(); });
      m.on("mouseover", () => { if (mapModeRef.current === "view") m.openPopup(); });
      m.on("mouseout", () => m.closePopup());
      m.on("popupopen", (e) => { const node = e.popup.getElement(); if (node) { node.querySelector(".leaflet-popup-content").style.cursor = "pointer"; node.querySelector(".leaflet-popup-content-wrapper").onclick = openFull; } });
      m.addTo(map);
      transitLayers.current[t.id] = m;
    });
  }, [transit, ready, showTransitOnMap]);

  // render event flag markers
  const eventLayers = useRef({});
  useEffect(() => {
    if (!ready) return;
    const L = LRef.current, map = mapRef.current;
    Object.keys(eventLayers.current).forEach((id) => {
      eventLayers.current[id].remove();
      delete eventLayers.current[id];
    });
    events.forEach((ev) => {
      if (ev.lat == null) return;
      const cd = countdown(ev);
      const badgeColor = cd.ongoing ? "#1D9E75" : (cd.past ? "#9A9A95" : "#C0392B");
      const html = `
        <div style="position:relative;display:flex;flex-direction:column;align-items:center;">
          <div style="font-size:22px;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.3));">🚩</div>
          <div style="margin-top:2px;background:${badgeColor};color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:8px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.3);">${cd.text || "—"}</div>
        </div>`;
      const icon = L.divIcon({ html, className: "cd-event", iconSize: [60, 44], iconAnchor: [30, 22] });
      const layer = L.marker([ev.lat, ev.lng], { icon });
      const openFullEv = () => setEventPanelId(ev.id);
      const thumbE = (ev.media || []).find((m) => m.type !== "video");
      layer.bindPopup(previewHTML({ title: ev.title || "Untitled event", meta: `🚩 ${cd.ongoing ? "Happening now" : cd.past ? "Past" : "In " + cd.text}${ev.venue ? " · " + ev.venue : ""}`, thumb: thumbE ? thumbE.url : "", dist: "", accent: "#C0392B" }), { offset: [0, -18], closeButton: false, className: "cd-preview-popup" });
      layer.on("click", (e) => { if (e.originalEvent) e.originalEvent.stopPropagation(); if (mapModeRef.current === "view") openFullEv(); });
      layer.on("mouseover", () => { if (mapModeRef.current === "view") layer.openPopup(); });
      layer.on("mouseout", () => layer.closePopup());
      layer.on("popupopen", (e) => { const node = e.popup.getElement(); if (node) { node.querySelector(".leaflet-popup-content").style.cursor = "pointer"; node.querySelector(".leaflet-popup-content-wrapper").onclick = openFullEv; } });
      layer.addTo(map);
      eventLayers.current[ev.id] = layer;
    });
  }, [events, ready]);

  function pinIcon(L, color, emoji, favorite, visited) {
    // flatten the emoji to a solid silhouette: black on been-there, white on want-to-go
    const emojiFilter = visited ? "grayscale(1) brightness(0)" : "grayscale(1) brightness(0) invert(1)";
    const check = visited ? `<div style="position:absolute;top:-4px;right:-2px;width:16px;height:16px;border-radius:50%;background:#fff;color:#1C1C1C;font-size:10px;line-height:13px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.3);border:1.5px solid #913B09;">✓</div>` : "";
    const starPos = visited ? "top:-4px;left:-2px;" : "top:-4px;right:-2px;";
    const star = favorite ? `<div style="position:absolute;${starPos}width:16px;height:16px;border-radius:50%;background:#E0A21C;color:#fff;font-size:10px;line-height:16px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.3);">★</div>` : "";
    const html = `
      <div style="position:relative;width:30px;height:42px;">
        <svg width="30" height="42" viewBox="0 0 30 42" xmlns="http://www.w3.org/2000/svg">
          <path d="M15 0C6.7 0 0 6.7 0 15c0 11 15 27 15 27s15-16 15-27C30 6.7 23.3 0 15 0z" fill="${color}"/>
        </svg>
        <div style="position:absolute;top:4px;left:0;width:30px;text-align:center;font-size:14px;filter:${emojiFilter};">${emoji || "📍"}</div>
        ${check}
        ${star}
      </div>`;
    return L.divIcon({ html, className: "cd-pin", iconSize: [30, 42], iconAnchor: [15, 42], tooltipAnchor: [0, -36] });
  }

  function focusItem(it, mode = "read") {
    setView("map");
    setSelectedId(it.id);
    const map = mapRef.current;
    if (!map) { setPanelId(it.id); setPanelMode(mode); return; }
    setTimeout(() => {
      map.invalidateSize();
      if (it.kind === "pin") map.setView([it.lat, it.lng], 15, { animate: true });
      else map.fitBounds(it.path, { padding: [40, 40] });
      const layer = layersRef.current[it.id];
      if (layer && layer.openTooltip) layer.openTooltip();
      setPanelId(it.id);
      setPanelMode(mode);
    }, 60);
  }

  // pan to the item on the full map and CLOSE the panel (so it doesn't cover the map)
  function locateAndClose(it) {
    setView("map");
    setSelectedId(it.id);
    setPanelId(null);
    setPanelMode("read");
    const map = mapRef.current;
    if (!map) return;
    setTimeout(() => {
      map.invalidateSize();
      if (it.kind === "pin") map.setView([it.lat, it.lng], 15, { animate: true });
      else map.fitBounds(it.path, { padding: [40, 40] });
      const layer = layersRef.current[it.id];
      if (layer && layer.openTooltip) layer.openTooltip();
    }, 60);
  }

  // open the reading panel without leaving the current view (used from the list)
  function openReading(it) {
    setSelectedId(it.id);
    setPanelId(it.id);
    setPanelMode("read");
  }

  // begin editing an item: snapshot it so edits can be discarded
  function beginEdit(it, isNew = false) {
    editSnapshot.current = { ...it };
    editIsNew.current = isNew;
    setEditDirty(false);
    setPanelMode("edit");
  }

  // call before any navigation that would leave an open editor.
  // returns true if it's safe to proceed now; false if a dialog was raised.
  function guardNav(action) {
    if (panelModeRef.current === "edit" && (editDirtyRef.current || editIsNew.current)) {
      setPendingNav(() => action);
      setUnsavedOpen(true);
      return false;
    }
    action();
    return true;
  }

  function resolveUnsaved(choice) {
    const action = pendingNav;
    setUnsavedOpen(false);
    setPendingNav(null);
    if (choice === "cancel") return; // stay put
    if (choice === "discard") {
      if (editIsNew.current && panelId) {
        // brand-new item never meant to persist -> remove it (memory + db)
        const discardId = panelId;
        setItems((prev) => prev.filter((it) => it.id !== discardId));
        dbDeleteItem(discardId).catch((e) => console.error("discard delete", e));
      } else if (editSnapshot.current) {
        const snap = editSnapshot.current;
        setItems((prev) => prev.map((it) => (it.id === snap.id ? snap : it)));
        persistItem(snap); // restore the pre-edit version in the db
      }
    }
    if (choice === "save" && panelId) {
      const cur = items.find((it) => it.id === panelId);
      if (cur) persistItem(cur);
    }
    editSnapshot.current = null;
    editIsNew.current = false;
    setEditDirty(false);
    setPanelMode("read");
    if (action) action();
  }

  const updateItem = (id, patch) =>
    setItems((prev) => {
      const next = prev.map((it) => (it.id === id ? { ...it, ...patch } : it));
      const updated = next.find((it) => it.id === id);
      if (updated) persistItem(updated);
      return next;
    });

  const deleteItem = (id) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
    dbDeleteItem(id).catch((e) => console.error("delete item", e));
    if (panelId === id) { setPanelId(null); setPanelMode("read"); }
    if (selectedId === id) setSelectedId(null);
  };

  const addMedia = (id, files) => {
    const arr = Array.from(files);
    Promise.all(arr.map((f) => new Promise((res) => {
      const reader = new FileReader();
      reader.onload = () => res({ id: uid(), type: f.type.startsWith("video") ? "video" : "image", name: f.name, url: reader.result });
      reader.readAsDataURL(f);
    }))).then((media) => {
      setItems((prev) => prev.map((it) => it.id === id ? { ...it, media: [...it.media, ...media] } : it));
    });
  };

  // ---------- live location tracking ----------
  useEffect(() => { followingRef.current = following; }, [following]);

  // draw / update the blue position dot whenever userPos changes
  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current, L = LRef.current;
    if (!userPos) return;
    if (!hereMarker.current) {
      const icon = L.divIcon({
        html: `<div style="width:18px;height:18px;border-radius:50%;background:#185FA5;border:3px solid #fff;box-shadow:0 0 0 2px #185FA5;"></div>`,
        className: "cd-here", iconSize: [18, 18], iconAnchor: [9, 9],
      });
      hereMarker.current = L.marker([userPos.lat, userPos.lng], { icon, interactive: false }).addTo(map);
    } else {
      hereMarker.current.setLatLng([userPos.lat, userPos.lng]);
    }
    if (followingRef.current) map.setView([userPos.lat, userPos.lng], map.getZoom() < 14 ? 16 : map.getZoom(), { animate: true });
  }, [userPos, ready]);

  // turning the manual map drag off follow mode
  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    const onDrag = () => { if (followingRef.current) setFollowing(false); };
    map.on("dragstart", onDrag);
    return () => map.off("dragstart", onDrag);
  }, [ready]);

  function startWatch() {
    if (watchId.current != null || !navigator.geolocation) return;
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => { setFollowing(false); },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );
  }

  function toggleFollow() {
    if (!navigator.geolocation) return;
    if (following) {
      setFollowing(false);
      return;
    }
    // turn on: ensure we're watching, center now, and follow
    startWatch();
    setFollowing(true);
    const map = mapRef.current;
    if (userPos && map) map.setView([userPos.lat, userPos.lng], 16, { animate: true });
    else {
      // no fix yet — grab one immediately to center
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setUserPos(p);
          if (map) map.setView([p.lat, p.lng], 16, { animate: true });
        },
        () => setFollowing(false),
        { enableHighAccuracy: true, timeout: 8000 }
      );
    }
  }

  // start watching once on mount so the dot is visible without enabling follow
  useEffect(() => {
    if (!ready) return;
    startWatch();
    return () => { if (watchId.current != null && navigator.geolocation) { navigator.geolocation.clearWatch(watchId.current); watchId.current = null; } };
    // eslint-disable-next-line
  }, [ready]);

  // ---------- search ----------
  function runSearch(e) {
    if (e) e.preventDefault();
    const q = searchQuery.trim();
    if (!q) { setSearchResults(null); return; }
    setSearching(true);
    searchPlaces(q).then((results) => {
      setSearchResults(results);
      setSearching(false);
    }).catch(() => { setSearchResults([]); setSearching(false); });
  }

  function chooseResult(r) {
    const map = mapRef.current;
    setSearchResults(null);
    setSearchOpen(false);
    setSearchQuery(r.name || r.address || "");
    if (map) map.setView([r.lat, r.lng], 15, { animate: true });
  }

  // ---------- Snap: camera -> location -> pin ----------
  function startSnap() {
    setSnapMsg("");
    if (snapInputRef.current) snapInputRef.current.click();
  }

  function onSnapFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (!navigator.geolocation) {
      setSnapMsg("Location isn't available on this device, so Snap can't place the pin.");
      return;
    }
    // read the file while we wait for location
    const reader = new FileReader();
    reader.onload = () => {
      const media = { id: uid(), type: file.type.startsWith("video") ? "video" : "image", name: file.name, url: reader.result };
      navigator.geolocation.getCurrentPosition(
        (pos) => createSnapPin(pos.coords.latitude, pos.coords.longitude, media),
        () => setSnapMsg("Snap needs your location to place the pin. Enable location access and try again."),
        { enableHighAccuracy: true, timeout: 8000 }
      );
    };
    reader.readAsDataURL(file);
  }

  function createSnapPin(lat, lng, media) {
    const id = uid();
    const newPin = {
      id, kind: "pin", status: STATUS.VISITED, category: "other",
      title: "", description: "", note: "", date: "", city: "",
      lat, lng, media: [media], hidden: false, favorite: false,
    };
    setItems((prev) => [...prev, newPin]); persistItem(newPin);
    setSelectedId(id);
    setPanelId(id);
    editSnapshot.current = { ...newPin };
    editIsNew.current = true;
    setEditDirty(false);
    setPanelMode("edit");
    setView("map");
    const map = mapRef.current;
    if (map) setTimeout(() => map.setView([lat, lng], 16, { animate: true }), 40);
    reverseGeocode(lat, lng).then((city) => {
      if (city) setItems((prev) => prev.map((it) => (it.id === id && !it.city ? { ...it, city } : it)));
    });
  }

  // ---------- transit stops ----------
  function enterAddTransit() {
    setView("map");
    setMapMode("addTransit");
    const map = mapRef.current;
    if (map) { map.dragging.enable(); setMapCursor("crosshair"); }
  }
  function placeTransitStop(latlng) {
    const id = uid();
    const last = transit[transit.length - 1];
    const stop = {
      id, name: "", line: last ? last.line : "", color: last ? last.color : TRANSIT_COLORS[0].color,
      type: last ? last.type : "rail",
      lat: latlng.lat, lng: latlng.lng,
    };
    setTransit((prev) => [...prev, stop]);
    persistTransit(stop);
    setTransitPanelId(id);
    setMapMode("view");
    setMapCursor("");
  }
  function updateTransit(id, patch) {
    setTransit((prev) => {
      const next = prev.map((t) => (t.id === id ? { ...t, ...patch } : t));
      const u = next.find((t) => t.id === id); if (u) persistTransit(u);
      return next;
    });
  }
  function deleteTransit(id) {
    setTransit((prev) => prev.filter((t) => t.id !== id));
    dbDeleteTransit(id).catch((e) => console.error("delete transit", e));
    if (transitPanelId === id) setTransitPanelId(null);
  }

  // ---------- events ----------
  function createEvent(addressFallbackCenter = true) {
    const id = uid();
    const map = mapRef.current;
    let lat, lng;
    if (userPos) { lat = userPos.lat; lng = userPos.lng; }
    else if (map && addressFallbackCenter) { const c = map.getCenter(); lat = c.lat; lng = c.lng; }
    else { lat = 14.5764; lng = 121.0851; }
    const ev = { id, title: "", venue: "", lat, lng, datetime: "", allDay: false, mode: "single", startDate: "", endDate: "", dates: [], media: [] };
    setEvents((prev) => [...prev, ev]);
    persistEvent(ev);
    setEventPanelId(id);
    return id;
  }
  function updateEvent(id, patch) {
    setEvents((prev) => {
      const next = prev.map((e) => (e.id === id ? { ...e, ...patch } : e));
      const u = next.find((e) => e.id === id); if (u) persistEvent(u);
      return next;
    });
  }
  function deleteEvent(id) {
    setEvents((prev) => prev.filter((e) => e.id !== id));
    dbDeleteEvent(id).catch((e) => console.error("delete event", e));
    if (eventPanelId === id) setEventPanelId(null);
  }
  function setEventAddress(id, address) {
    updateEvent(id, { venue: address });
    geocodeAddress(address).then((coords) => {
      if (coords) updateEvent(id, { lat: coords.lat, lng: coords.lng });
    });
  }
  function addEventMedia(id, files) {
    const arr = Array.from(files);
    Promise.all(arr.map((f) => new Promise((res) => {
      const reader = new FileReader();
      reader.onload = () => res({ id: uid(), type: f.type.startsWith("video") ? "video" : "image", name: f.name, url: reader.result });
      reader.readAsDataURL(f);
    }))).then((media) => updateEvent(id, { media: [...(events.find((e) => e.id === id)?.media || []), ...media] }));
  }
  // upcoming events sorted by soonest date, soonest first
  const upcomingEvents = events
    .filter((e) => eventHasUpcoming(e))
    .sort((a, b) => eventSortKey(a) - eventSortKey(b));

  // ---------- favorites ----------
  function toggleFavorite(id) {
    setItems((prev) => {
      const next = prev.map((it) => (it.id === id ? { ...it, favorite: !it.favorite } : it));
      const u = next.find((it) => it.id === id);
      if (u) persistItem(u);
      return next;
    });
  }

  // Complete the "did you go?" flow: mark visited, set date, add photos, append update to notes.
  function completeWent(id, { date, media, update, stamp }) {
    setItems((prev) => {
      const next = prev.map((it) => {
        if (it.id !== id) return it;
        let note = it.note || "";
        if (update && update.trim()) {
          const label = stamp || date || new Date().toLocaleDateString();
          note = (note ? note + "\n\n" : "") + `Update - ${label}: ${update.trim()}`;
        }
        return {
          ...it,
          status: STATUS.VISITED,
          date: date || it.date,
          note,
          media: [...(it.media || []), ...(media || [])],
        };
      });
      const u = next.find((it) => it.id === id);
      if (u) persistItem(u);
      return next;
    });
    setDidYouGoFor(null);
  }

  // ---------- category management ----------
  function addCategory(name) {
    const clean = name.trim().toLowerCase();
    if (!clean) return false;
    if (categories.some((c) => c.name === clean)) return false;
    const withoutOther = categories.filter((c) => c.name !== "other");
    const other = categories.find((c) => c.name === "other") || { name: "other", icon: "📍" };
    const next = [...withoutOther, { name: clean, icon: "📍" }, other];
    setCategories(next); persistPinCats(next);
    setMapCats((prev) => new Set([...prev, clean]));
    return true;
  }
  function removeCategory(cat, moveTo) {
    if (cat === "other") return;
    setItems((prev) => {
      const next = prev.map((it) => (it.category === cat ? { ...it, category: moveTo || "other" } : it));
      next.filter((it) => it.category === (moveTo || "other") && prev.find((p) => p.id === it.id && p.category === cat)).forEach(persistItem);
      return next;
    });
    const next = categories.filter((c) => c.name !== cat);
    setCategories(next); persistPinCats(next);
    setMapCats((prev) => { const n = new Set(prev); n.delete(cat); return n; });
  }
  function setCategoryIcon(cat, icon) {
    const next = categories.map((c) => (c.name === cat ? { ...c, icon } : c));
    setCategories(next); persistPinCats(next);
  }
  const countInCategory = (cat) => items.filter((it) => it.kind === "pin" && it.category === cat).length;

  // ---------- path category management ----------
  function addPathCategory(name) {
    const clean = name.trim().toLowerCase();
    if (!clean) return false;
    if (pathCategories.some((c) => c.name === clean)) return false;
    const withoutOther = pathCategories.filter((c) => c.name !== "other");
    const other = pathCategories.find((c) => c.name === "other") || { name: "other", icon: "🧭", color: "#534AB7" };
    const next = [...withoutOther, { name: clean, icon: "🧭", color: PATH_CATEGORY_COLORS[withoutOther.length % PATH_CATEGORY_COLORS.length] }, other];
    setPathCategories(next); persistPathCats(next);
    setMapPathCats((prev) => new Set([...prev, clean]));
    return true;
  }
  function removePathCategory(cat, moveTo) {
    if (cat === "other") return;
    setItems((prev) => {
      const next = prev.map((it) => (it.kind === "shape" && it.category === cat ? { ...it, category: moveTo || "other" } : it));
      next.filter((it) => it.kind === "shape" && prev.find((p) => p.id === it.id && p.category === cat)).forEach(persistItem);
      return next;
    });
    const next = pathCategories.filter((c) => c.name !== cat);
    setPathCategories(next); persistPathCats(next);
    setMapPathCats((prev) => { const n = new Set(prev); n.delete(cat); return n; });
  }
  function setPathCategoryIcon(cat, icon) {
    const next = pathCategories.map((c) => (c.name === cat ? { ...c, icon } : c));
    setPathCategories(next); persistPathCats(next);
  }
  function setPathCategoryColor(cat, color) {
    const next = pathCategories.map((c) => (c.name === cat ? { ...c, color } : c));
    setPathCategories(next); persistPathCats(next);
  }
  const countInPathCategory = (cat) => items.filter((it) => it.kind === "shape" && it.category === cat).length;
  const pathCatColor = (name) => { const c = pathCategories.find((x) => x.name === name); return c ? c.color : C.shape; };
  const pathCatIcon = (name) => { const c = pathCategories.find((x) => x.name === name); return c ? c.icon : "🧭"; };

  // ---------- notebooks ----------
  function createNotebook() {
    const id = uid();
    const nb = { id, title: "", description: "", entries: [] };
    setNotebooks((prev) => [...prev, nb]);
    persistNotebook(nb);
    setOpenNotebookId(id);
  }
  function updateNotebook(id, patch) {
    setNotebooks((prev) => {
      const next = prev.map((n) => (n.id === id ? { ...n, ...patch } : n));
      const u = next.find((n) => n.id === id); if (u) persistNotebook(u);
      return next;
    });
  }
  function deleteNotebook(id) {
    setNotebooks((prev) => prev.filter((n) => n.id !== id));
    dbDeleteNotebook(id).catch((e) => console.error("delete notebook", e));
    if (openNotebookId === id) setOpenNotebookId(null);
  }
  function addPinToNotebook(notebookId, pinId) {
    setNotebooks((prev) => {
      const next = prev.map((n) => {
        if (n.id !== notebookId) return n;
        if (n.entries.some((e) => e.pinId === pinId)) return n;
        return { ...n, entries: [...n.entries, { pinId, caption: "" }] };
      });
      const u = next.find((n) => n.id === notebookId); if (u) persistNotebook(u);
      return next;
    });
  }
  function removePinFromNotebook(notebookId, pinId) {
    setNotebooks((prev) => {
      const next = prev.map((n) =>
        n.id === notebookId ? { ...n, entries: n.entries.filter((e) => e.pinId !== pinId) } : n);
      const u = next.find((n) => n.id === notebookId); if (u) persistNotebook(u);
      return next;
    });
  }
  function setEntryCaption(notebookId, pinId, caption) {
    setNotebooks((prev) => {
      const next = prev.map((n) =>
        n.id === notebookId ? { ...n, entries: n.entries.map((e) => e.pinId === pinId ? { ...e, caption } : e) } : n);
      const u = next.find((n) => n.id === notebookId); if (u) persistNotebook(u);
      return next;
    });
  }

  const panelItem = items.find((it) => it.id === panelId) || null;

  // Occasional prompt: the first time you open a want-to-go item (per session), ask if you went.
  useEffect(() => {
    if (panelItem && panelMode === "read" && panelItem.status === STATUS.WISHLIST
        && !promptedWentRef.current.has(panelItem.id) && !didYouGoFor) {
      promptedWentRef.current.add(panelItem.id);
      const t = setTimeout(() => setDidYouGoFor(panelItem.id), 600);
      return () => clearTimeout(t);
    }
  }, [panelId, panelMode]); // eslint-disable-line

  const cities = Array.from(new Set(items.map((it) => it.city).filter(Boolean))).sort();
  const filtered = items.filter((it) => {
    if (cityFilter !== "all" && it.city !== cityFilter) return false;
    if (categoryFilter !== "all" && it.category !== categoryFilter) return false;
    return true;
  });
  const visited = filtered.filter((it) => it.status === STATUS.VISITED);
  const wishlist = filtered.filter((it) => it.status === STATUS.WISHLIST);
  const favorites = items.filter((it) => it.favorite);

  // text search across title/description/notes/category for items + events + transit
  const sq = listSearch.trim().toLowerCase();
  const searchActive = sq.length > 0;
  const matchText = (...parts) => parts.filter(Boolean).join(" ").toLowerCase().includes(sq);
  const searchPins = searchActive ? items.filter((it) => it.kind === "pin" && matchText(it.title, it.description, it.note, it.category)) : [];
  const searchPaths = searchActive ? items.filter((it) => it.kind === "shape" && matchText(it.title, it.description, it.note)) : [];
  const searchTransit = searchActive ? transit.filter((t) => matchText(t.name, t.line, transitType(t.type).label)) : [];
  const searchEvents = searchActive ? events.filter((e) => matchText(e.title, e.venue)) : [];
  const searchTotal = searchPins.length + searchPaths.length + searchTransit.length + searchEvents.length;

  const s = makeStyles();
  const adding = mapMode !== "view";

  if (!loaded) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", color: "#5F5E5A", background: "#F4F2EC" }}>
        {loadError ? `Couldn't load your data: ${loadError}` : "Loading your map…"}
      </div>
    );
  }

  return (
    <div style={s.app}>
      <header style={s.header}>
        <div style={{ ...s.brand, ...(view === "map" ? {} : s.brandOnLight) }}>
          <span style={s.logoDot} />
          <span>CityDweller</span>
        </div>
        {view !== "map" && (
          <div style={s.tabs}>
            <button style={s.signOutBtn} onClick={() => signOut && signOut()} title="Sign out">⎋ Sign out</button>
          </div>
        )}
      </header>

      <div style={s.body}>
        {/* MAP VIEW */}
        <div style={{ ...s.mapWrap, display: view === "map" ? "flex" : "none" }}>
          <div style={s.mapToolbar}>
            <div style={s.toolBtns}>
              {!adding && mapMode !== "addTransit" && (
                <div style={s.filterWrap}>
                  <button style={{ ...s.filterToggle, ...((mapCats.size < categories.length || !showLinesOnMap || !showTransitOnMap) ? s.filterToggleActive : {}) }} onClick={() => setCatMenuOpen((v) => !v)}>
                    Filter{(mapCats.size < categories.length || !showLinesOnMap || !showTransitOnMap) ? " •" : ""} ▾
                  </button>
                  {catMenuOpen && (
                    <div style={s.catMenu}>
                      <div style={s.catMenuHead}>
                        <button style={s.catMenuLink} onClick={() => { setMapCats(new Set(categories.map((c) => c.name))); setShowLinesOnMap(true); setMapPathCats(new Set(pathCategories.map((c) => c.name))); setShowTransitOnMap(true); }}>All</button>
                        <button style={s.catMenuLink} onClick={() => { setMapCats(new Set()); setShowLinesOnMap(false); setMapPathCats(new Set()); setShowTransitOnMap(false); }}>None</button>
                      </div>

                      {/* Pins accordion */}
                      <div style={s.accHeader}>
                        <input
                          type="checkbox"
                          checked={mapCats.size > 0}
                          onChange={(e) => { e.stopPropagation(); setMapCats(mapCats.size > 0 ? new Set() : new Set(categories.map((c) => c.name))); }}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <button style={s.accTitleBtn} onClick={() => setPinsAccordionOpen((v) => !v)}>
                          <span style={{ fontWeight: 600 }}>Pins</span>
                          <span style={s.accChevron}>{pinsAccordionOpen ? "▴" : "▾"}</span>
                        </button>
                      </div>
                      {pinsAccordionOpen && categories.map((cat) => (
                        <label key={cat.name} style={{ ...s.catRow, paddingLeft: 22 }}>
                          <input
                            type="checkbox"
                            checked={mapCats.has(cat.name)}
                            onChange={() => setMapCats((prev) => { const n = new Set(prev); if (n.has(cat.name)) n.delete(cat.name); else n.add(cat.name); return n; })}
                          />
                          <span>{cat.icon} {catLabel(cat.name)}</span>
                        </label>
                      ))}

                      <div style={s.catMenuDivider} />

                      {/* Paths accordion */}
                      <div style={s.accHeader}>
                        <input
                          type="checkbox"
                          checked={showLinesOnMap}
                          onChange={() => setShowLinesOnMap((v) => !v)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <button style={s.accTitleBtn} onClick={() => setPathsAccordionOpen((v) => !v)}>
                          <span style={{ fontWeight: 600 }}>Paths</span>
                          <span style={s.accChevron}>{pathsAccordionOpen ? "▴" : "▾"}</span>
                        </button>
                      </div>
                      {pathsAccordionOpen && pathCategories.map((pc) => (
                        <label key={pc.name} style={{ ...s.catRow, paddingLeft: 22 }}>
                          <input
                            type="checkbox"
                            checked={mapPathCats.has(pc.name)}
                            onChange={() => setMapPathCats((prev) => { const n = new Set(prev); if (n.has(pc.name)) n.delete(pc.name); else n.add(pc.name); return n; })}
                          />
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: pc.color, display: "inline-block" }} />{pc.icon} {catLabel(pc.name)}</span>
                        </label>
                      ))}

                      <div style={s.catMenuDivider} />
                      <label style={s.catRow}>
                        <input type="checkbox" checked={showTransitOnMap} onChange={() => setShowTransitOnMap((v) => !v)} />
                        <span>Transit stops</span>
                      </label>
                    </div>
                  )}
                </div>
              )}
              {mapMode === "addTransit" ? (
                <button style={s.cancelAdd} onClick={() => { setMapMode("view"); setMapCursor(""); }}>Cancel</button>
              ) : !adding ? (
                <>
                  <button style={{ ...s.addBtn, borderRadius: 999, whiteSpace: "nowrap" }} onClick={enterAddPin}>+ Add pin</button>
                  <button style={{ ...s.addBtnAlt, borderRadius: 999, whiteSpace: "nowrap" }} onClick={enterAddLine}>+ Add path</button>
                  <button style={{ ...s.addBtnTransit, borderRadius: 999, whiteSpace: "nowrap" }} onClick={enterAddTransit}>🚇 Add transit stop</button>
                  <button style={{ ...s.addBtnEvent, borderRadius: 999, whiteSpace: "nowrap" }} onClick={() => { setView("map"); createEvent(); }}>🚩 Add event</button>
                </>
              ) : (
                <button style={s.cancelAdd} onClick={exitAddMode}>Cancel</button>
              )}
            </div>
          </div>
          {mapMode === "addTransit" && (
            <div style={s.drawBanner}>Tap the map to place a transit stop, then name it and set its line.</div>
          )}
          {mapMode === "addLine" && (
            <div style={s.drawBanner}>Press and drag on the map to draw a path. Release to finish.</div>
          )}
          {mapMode === "addPin" && (
            <div style={s.drawBanner}>Click anywhere on the map to drop your pin.</div>
          )}
          <div ref={mapEl} style={s.map} />
          {ready && (
            <div style={s.viewSwitcher}>
              {[
                ["street", "Street", <svg key="s" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>],
                ["satellite", "Satellite", <svg key="sat" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>],
                ["terrain", "Terrain", <svg key="t" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 20h18L14 8l-3 5-2-3-6 10z"/></svg>],
              ].map(([v, label, icon]) => (
                <button key={v} title={label} aria-label={label} style={{ ...s.viewBtn, ...(mapView === v ? s.viewBtnOn : {}) }} onClick={() => switchMapView(v)}>{icon}</button>
              ))}
            </div>
          )}
          {!ready && <div style={s.loading}>Loading map…</div>}

          {/* upcoming events box (top-right) */}
          {view === "map" && upcomingEvents.length > 0 && (
            <div style={s.eventsBox}>
              <div style={s.eventsBoxTitle}>Upcoming events</div>
              {upcomingEvents.slice(0, 3).map((ev) => {
                const cd = countdown(ev);
                return (
                  <button key={ev.id} style={s.eventsBoxRow} onClick={() => { setEventPanelId(ev.id); const m = mapRef.current; if (m && ev.lat != null) m.setView([ev.lat, ev.lng], 15, { animate: true }); }}>
                    <span style={s.eventsBoxName}>{ev.title || "Untitled event"}</span>
                    <span style={s.eventsBoxCd}>{cd.text}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* hidden camera input for Snap (opens camera on mobile) */}
          <input
            ref={snapInputRef}
            type="file"
            accept="image/*,video/*"
            capture="environment"
            style={{ display: "none" }}
            onChange={onSnapFile}
          />

          {/* expanding search panel */}
          {searchOpen && view === "map" && (
            <div style={s.searchPanel}>
              <form style={s.searchForm} onSubmit={runSearch}>
                <span style={s.searchIcon}>⌕</span>
                <input
                  style={s.searchInput}
                  value={searchQuery}
                  placeholder="Search a place or address"
                  autoFocus
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button type="button" style={s.searchClear} onClick={() => { setSearchQuery(""); setSearchResults(null); }} aria-label="Clear">✕</button>
                )}
                <button type="submit" style={s.searchGo}>Go</button>
                <button type="button" style={s.searchClose} onClick={() => { setSearchOpen(false); setSearchResults(null); }} aria-label="Close search">✕</button>
              </form>
              {searchResults !== null && (
                <div style={s.searchResults}>
                  {searching && <div style={s.searchMsg}>Searching…</div>}
                  {!searching && searchResults.length === 0 && (
                    <div style={s.searchMsg}>No matches here. Place search runs against the geocoding service in your live build.</div>
                  )}
                  {!searching && searchResults.map((r, i) => (
                    <button key={i} style={s.searchResult} onClick={() => chooseResult(r)}>
                      <div style={s.searchResultName}>{r.name}</div>
                      {r.address && <div style={s.searchResultAddr}>{r.address}</div>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* snap message (e.g. location denied) */}
          {snapMsg && view === "map" && (
            <div style={s.snapMsg}>
              {snapMsg}
              <button style={s.snapMsgClose} onClick={() => setSnapMsg("")} aria-label="Dismiss">✕</button>
            </div>
          )}

          {/* floating circular controls */}
          {view === "map" && (
            <div style={s.fabRow}>
              <button style={s.fab} onClick={startSnap} title="Snap a photo and drop a pin" aria-label="Snap">
                <span style={s.fabGlyph}>◉</span>
              </button>
              <button style={s.fab} onClick={() => setSearchOpen((v) => !v)} title="Search a place" aria-label="Search">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.text} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
              </button>
              <button
                style={{ ...s.fab, ...(following ? s.fabActive : {}) }}
                onClick={toggleFollow}
                title={following ? "Following your location — tap to stop" : "Follow my location"}
                aria-label="My location"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={following ? "#185FA5" : C.text} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l18-8-8 18-2-8-8-2z"/></svg>
              </button>
            </div>
          )}
        </div>

        {/* LIST VIEW */}
        {view === "list" && (
          <div style={s.listWrap}>
            <div style={s.listTopRow}>
              <div style={s.modeToggle}>
                <button style={{ ...s.modeBtn, ...(listMode === "places" ? s.modeBtnOn : {}) }} onClick={() => setListMode("places")}>All places</button>
                <button style={{ ...s.modeBtn, ...(listMode === "favorites" ? s.modeBtnOn : {}) }} onClick={() => setListMode("favorites")}>★ Favorites</button>
                <button style={{ ...s.modeBtn, ...(listMode === "notebooks" ? s.modeBtnOn : {}) }} onClick={() => setListMode("notebooks")}>📓 Notebooks</button>
              </div>
              {listSearchOpen ? (
                <div style={s.listSearchBox}>
                  <span style={{ color: C.sub }}>⌕</span>
                  <input
                    style={s.listSearchInput}
                    value={listSearch}
                    placeholder="Search all"
                    autoFocus
                    onChange={(e) => setListSearch(e.target.value)}
                  />
                  <button style={s.iconBtn} onClick={() => { setListSearch(""); setListSearchOpen(false); }} aria-label="Close search">✕</button>
                </div>
              ) : (
                <button style={s.listSearchToggle} onClick={() => setListSearchOpen(true)} aria-label="Search">⌕</button>
              )}
            </div>

            {searchActive && (
              <div>
                <p style={s.searchSummary}>{searchTotal} result{searchTotal === 1 ? "" : "s"} for “{listSearch.trim()}”</p>
                {searchPins.length > 0 && (
                  <ListSection title="Pins" color={C.visited} rows={searchPins} userPos={userPos} categories={categories} pathCategories={pathCategories} onClick={(it) => openReading(it)} hideHead={false} />
                )}
                {searchPaths.length > 0 && (
                  <ListSection title="Paths" color={C.shape} rows={searchPaths} userPos={userPos} categories={categories} pathCategories={pathCategories} onClick={(it) => openReading(it)} />
                )}
                {searchTransit.length > 0 && (
                  <div style={s.section}>
                    <div style={s.sectionHead}><span style={s.journalIcon}>🚇</span><h3 style={s.sectionTitle}>Transit</h3><span style={s.countPill}>{searchTransit.length}</span></div>
                    <div style={s.cards}>
                      {searchTransit.map((t) => (
                        <button key={t.id} style={s.card} onClick={() => setTransitPanelId(t.id)}>
                          <div style={s.cardImgPlaceholder}><span style={s.placeholderMark}>{transitType(t.type).icon}</span></div>
                          <div style={s.cardBody}>
                            <div style={s.cardTitle}>{t.name || "Transit stop"}</div>
                            <div style={s.cardMeta}>{transitType(t.type).label}{t.line ? ` · ${t.line}` : ""}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {searchEvents.length > 0 && (
                  <div style={s.section}>
                    <div style={s.sectionHead}><span style={s.journalIcon}>🚩</span><h3 style={s.sectionTitle}>Events</h3><span style={s.countPill}>{searchEvents.length}</span></div>
                    <div style={s.cards}>
                      {searchEvents.map((ev) => {
                        const cd = countdown(ev);
                        const photos = (ev.media || []).filter((m) => m.type !== "video");
                        return (
                          <button key={ev.id} style={s.card} onClick={() => setEventPanelId(ev.id)}>
                            {photos.length > 0 ? <div style={s.cardImgStrip}>{photos.map((m) => <img key={m.id} src={m.url} alt="" style={s.cardImg} />)}</div> : <div style={s.cardImgPlaceholder}><span style={s.placeholderMark}>🚩</span></div>}
                            <div style={s.cardBody}>
                              <div style={s.cardTitle}>{ev.title || "Untitled event"}</div>
                              {ev.venue && <div style={s.cardMeta}>{ev.venue}</div>}
                              <div style={s.chipRow}><span style={{ ...s.chip, color: cd.ongoing ? C.visited : (cd.past ? C.sub : "#C0392B"), borderColor: cd.ongoing ? C.visited : (cd.past ? C.border : "#C0392B") }}>{cd.ongoing ? "Ongoing" : (cd.past ? "Past" : cd.text)}</span></div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {searchTotal === 0 && <p style={s.empty}>Nothing matches “{listSearch.trim()}”.</p>}
              </div>
            )}

            {!searchActive && listMode === "places" && (
              <>
                <div style={s.listFilters}>
                  {["all", STATUS.VISITED, STATUS.WISHLIST].map((f) => (
                    <button key={f} style={{ ...s.filterBtn, ...(statusPill === f ? s.filterActive : {}) }} onClick={() => setStatusPill(f)}>
                      {f === "all" ? "All" : f === STATUS.VISITED ? "Been there" : "Want to go"}
                    </button>
                  ))}
                  <span style={s.divider} />
                  <select style={s.select} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                    <option value="all">All categories</option>
                    {categories.map((c) => <option key={c.name} value={c.name}>{c.icon} {catLabel(c.name)}</option>)}
                  </select>
                  <select style={s.select} value={cityFilter} onChange={(e) => setCityFilter(e.target.value)}>
                    <option value="all">All cities</option>
                    {cities.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                {(statusPill === "all" || statusPill === STATUS.VISITED) && (
                  <ListSection title="Been there" color={C.pinVisited} rows={visited} userPos={userPos} categories={categories} pathCategories={pathCategories} onFav={toggleFavorite} onClick={(it) => openReading(it)} />
                )}
                {(statusPill === "all" || statusPill === STATUS.WISHLIST) && (
                  <ListSection title="Want to go" color={C.pinWishlist} rows={wishlist} userPos={userPos} categories={categories} pathCategories={pathCategories} onFav={toggleFavorite} onClick={(it) => openReading(it)} onDidYouGo={(id) => setDidYouGoFor(id)} />
                )}

                {/* Favorites preview section */}
                {statusPill === "all" && (
                  <div style={s.section}>
                    <div style={s.sectionHead}>
                      <span style={{ ...s.journalIcon, color: "#E0A21C" }}>★</span>
                      <h3 style={s.sectionTitle}>Favorites</h3>
                      <span style={s.countPill}>{favorites.length}</span>
                      {favorites.length > 0 && <button style={s.sectionAction} onClick={() => setListMode("favorites")}>See all →</button>}
                    </div>
                    {favorites.length === 0
                      ? <p style={s.sectionEmpty}>No favorites yet. Your starred items will appear here.</p>
                      : <ListSection title="" color="#E0A21C" rows={favorites.slice(0, 3)} userPos={userPos} categories={categories} pathCategories={pathCategories} onFav={toggleFavorite} onClick={(it) => openReading(it)} hideHead />}
                  </div>
                )}

                {/* Notebooks preview section */}
                {statusPill === "all" && (
                  <div style={s.section}>
                    <div style={s.sectionHead}>
                      <span style={s.journalIcon}>📓</span>
                      <h3 style={s.sectionTitle}>Notebooks</h3>
                      <span style={s.countPill}>{notebooks.length}</span>
                      <button style={s.sectionAction} onClick={() => setListMode("notebooks")}>See all →</button>
                    </div>
                    {notebooks.length === 0 && (
                      <p style={s.sectionEmpty}>No notebooks yet. <button style={s.inlineLink} onClick={() => { setListMode("notebooks"); createNotebook(); }}>Create one</button> to group places into itineraries or collections.</p>
                    )}
                    <div style={s.cards}>
                      {notebooks.slice(-3).reverse().map((n) => (
                        <button key={n.id} style={s.card} onClick={() => { setListMode("notebooks"); setOpenNotebookId(n.id); }}>
                          <div style={s.cardTop}><span style={s.cardKind}>Notebook</span><span style={s.cardDate}>{n.entries.length} place{n.entries.length === 1 ? "" : "s"}</span></div>
                          <div style={s.cardTitle}>{n.title || "Untitled notebook"}</div>
                          {n.description && <div style={s.cardNote}>{n.description}</div>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {filtered.length === 0 && notebooks.length === 0 && <p style={s.empty}>No pins match. Add some on the map, or change the filters.</p>}
              </>
            )}

            {!searchActive && listMode === "favorites" && (
              <>
                <div style={s.sectionHead}>
                  <span style={{ ...s.journalIcon, color: "#E0A21C" }}>★</span>
                  <h3 style={s.sectionTitle}>Favorites</h3>
                  <span style={s.countPill}>{favorites.length}</span>
                </div>
                {favorites.length === 0 && <p style={s.sectionEmpty}>No favorites yet. Tap the ☆ on any place to favorite it.</p>}
                <ListSection title="" color="#E0A21C" rows={favorites} userPos={userPos} categories={categories} pathCategories={pathCategories} onFav={toggleFavorite} onClick={(it) => openReading(it)} hideHead />
              </>
            )}

            {!searchActive && listMode === "notebooks" && !openNotebookId && (
              <div>
                <div style={{ ...s.sectionHead, justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={s.journalIcon}>📓</span>
                    <h3 style={s.sectionTitle}>Your notebooks</h3>
                    <span style={s.countPill}>{notebooks.length}</span>
                  </div>
                  <button style={s.addBtn} onClick={createNotebook}>+ New notebook</button>
                </div>
                {notebooks.length === 0 && <p style={s.sectionEmpty}>No notebooks yet. Tap “New notebook” to start a collection or itinerary.</p>}
                <div style={s.cards}>
                  {notebooks.slice().reverse().map((n) => (
                    <button key={n.id} style={s.card} onClick={() => setOpenNotebookId(n.id)}>
                      <div style={s.cardTop}><span style={s.cardKind}>Notebook</span><span style={s.cardDate}>{n.entries.length} place{n.entries.length === 1 ? "" : "s"}</span></div>
                      <div style={s.cardTitle}>{n.title || "Untitled notebook"}</div>
                      {n.description && <div style={s.cardNote}>{n.description}</div>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {!searchActive && listMode === "notebooks" && openNotebookId && (
              <NotebookView
                notebook={notebooks.find((n) => n.id === openNotebookId)}
                items={items}
                onBack={() => setOpenNotebookId(null)}
                onChange={(patch) => updateNotebook(openNotebookId, patch)}
                onDelete={() => deleteNotebook(openNotebookId)}
                onOpenAdd={() => setAddToNotebookFor({ notebookId: openNotebookId })}
                onCaption={(pinId, caption) => setEntryCaption(openNotebookId, pinId, caption)}
                onRemove={(pinId) => removePinFromNotebook(openNotebookId, pinId)}
                onOpenPin={(pinId) => { const it = items.find((x) => x.id === pinId); if (it) openReading(it); }}
              />
            )}
          </div>
        )}

        {/* NEARBY VIEW */}
        {view === "nearby" && (
          <div style={s.listWrap}>
            <div style={s.sectionHead}>
              <span style={s.journalIcon}>◎</span>
              <h3 style={s.sectionTitle}>Nearby</h3>
            </div>
            {!userPos && (
              <div style={s.nearbyPrompt}>
                <p style={{ margin: "0 0 12px", color: C.sub, fontSize: 14 }}>Nearby sorts your pins and paths by distance from where you are. Enable location to use it.</p>
                <button style={s.addBtn} onClick={() => { setView("map"); setTimeout(toggleFollow, 100); }}>Enable location</button>
              </div>
            )}
            {userPos && (() => {
              const sorted = items
                .map((it) => ({ it, d: (itemCoord(it) ? distanceKm(userPos, itemCoord(it)) : Infinity) }))
                .sort((a, b) => a.d - b.d);
              if (sorted.length === 0) return <p style={s.empty}>No pins or paths yet. Add some on the map.</p>;
              return (
                <div style={s.cards}>
                  {sorted.map(({ it }) => {
                    const dist = itemCoord(it) ? distanceKm(userPos, itemCoord(it)) : null;
                    return (
                      <div key={it.id} style={s.cardWrap}>
                        <button style={s.card} onClick={() => openReading(it)}>
                          {it.media && it.media.filter((m) => m.type !== "video").length > 0 && (
                            <div style={s.cardImgStrip}>
                              {it.media.filter((m) => m.type !== "video").map((m) => <img key={m.id} src={m.url} alt="" style={s.cardImg} />)}
                            </div>
                          )}
                          <div style={s.cardBody}>
                            <div style={s.cardTitle}>{it.title || "Untitled"}</div>
                            <div style={s.cardMeta}>{it.kind === "pin" ? `${iconFor(categories, it.category)} ${catLabel(it.category)}` : `${pathCatIcon(it.category)} ${catLabel(it.category)}`}</div>
                            <div style={s.chipRow}>
                              {dist != null && <span style={{ ...s.chip, color: "#185FA5", borderColor: "#185FA5" }}>{formatKm(dist)}</span>}
                              {it.city && <span style={s.chip}>{it.city}</span>}
                            </div>
                          </div>
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}

        {/* EVENTS VIEW */}
        {view === "events" && (
          <div style={s.listWrap}>
            <div style={{ ...s.sectionHead, justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={s.journalIcon}>🚩</span>
                <h3 style={s.sectionTitle}>Events</h3>
                <span style={s.countPill}>{events.length}</span>
              </div>
              <button style={{ ...s.addBtn, background: "#C0392B" }} onClick={() => createEvent()}>+ New event</button>
            </div>
            {events.length === 0 && <p style={s.sectionEmpty}>No events yet. Tap “New event” to add one with a date and venue.</p>}
            {(() => {
              const sorted = events.slice().sort((a, b) => eventSortKey(a) - eventSortKey(b));
              return (
                <div style={s.cards}>
                  {sorted.map((ev) => {
                    const cd = countdown(ev);
                    const photos = (ev.media || []).filter((m) => m.type !== "video");
                    return (
                      <button key={ev.id} style={s.card} onClick={() => setEventPanelId(ev.id)}>
                        {photos.length > 0 ? (
                          <div style={s.cardImgStrip}>{photos.map((m) => <img key={m.id} src={m.url} alt="" style={s.cardImg} />)}</div>
                        ) : (
                          <div style={s.cardImgPlaceholder}><span style={s.placeholderMark}>🚩</span></div>
                        )}
                        <div style={s.cardBody}>
                          <div style={s.cardTitle}>{ev.title || "Untitled event"}</div>
                          {ev.venue && <div style={s.cardMeta}>{ev.venue}</div>}
                          <div style={s.chipRow}>
                            <span style={{ ...s.chip, color: cd.ongoing ? C.visited : (cd.past ? C.sub : "#C0392B"), borderColor: cd.ongoing ? C.visited : (cd.past ? C.border : "#C0392B") }}>{cd.ongoing ? "Ongoing" : (cd.past ? "Past" : cd.text)}</span>
                            {eventDateSummary(ev) && <span style={s.chip}>{eventDateSummary(ev)}</span>}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}

        {/* TRANSIT STOP PANEL */}
        {transitPanelId && (() => {
          const t = transit.find((x) => x.id === transitPanelId);
          if (!t) return null;
          return (
            <TransitPanel
              stop={t}
              onClose={() => setTransitPanelId(null)}
              onChange={(patch) => updateTransit(t.id, patch)}
              onDelete={() => deleteTransit(t.id)}
              onShowOnMap={() => { setView("map"); const m = mapRef.current; if (m) setTimeout(() => m.setView([t.lat, t.lng], 15, { animate: true }), 60); }}
            />
          );
        })()}

        {/* EVENT EDITOR PANEL */}
        {eventPanelId && (() => {
          const ev = events.find((e) => e.id === eventPanelId);
          if (!ev) return null;
          return (
            <EventPanel
              event={ev}
              onClose={() => setEventPanelId(null)}
              onChange={(patch) => updateEvent(ev.id, patch)}
              onAddress={(addr) => setEventAddress(ev.id, addr)}
              onAddMedia={(files) => addEventMedia(ev.id, files)}
              onRemoveMedia={(mid) => updateEvent(ev.id, { media: ev.media.filter((m) => m.id !== mid) })}
              onDelete={() => deleteEvent(ev.id)}
              onShowOnMap={() => { setView("map"); const m = mapRef.current; if (m && ev.lat != null) setTimeout(() => m.setView([ev.lat, ev.lng], 15, { animate: true }), 60); }}
            />
          );
        })()}

        {/* SIDE PANEL: reading or editing (not on events view) */}
        {panelItem && panelMode === "read" && view !== "events" && (
          <ReadPanel
            item={panelItem}
            onClose={() => setPanelId(null)}
            onEdit={() => beginEdit(panelItem)}
            onToggleHidden={() => updateItem(panelItem.id, { hidden: !panelItem.hidden })}
            onLocate={() => locateAndClose(panelItem)}
            onAddToNotebook={panelItem.kind === "pin" ? () => setAddToNotebookFor({ pinId: panelItem.id }) : null}
            onToggleFavorite={() => toggleFavorite(panelItem.id)}
            onDidYouGo={panelItem.status === STATUS.WISHLIST ? () => setDidYouGoFor(panelItem.id) : null}
          />
        )}
        {panelItem && panelMode === "edit" && view !== "events" && (
          <EditPanel
            item={panelItem}
            categories={panelItem.kind === "shape" ? pathCategories : categories}
            onChange={(patch) => { setEditDirty(true); updateItem(panelItem.id, patch); }}
            onAddMedia={(files) => { setEditDirty(true); addMedia(panelItem.id, files); }}
            onRemoveMedia={(mid) => { setEditDirty(true); updateItem(panelItem.id, { media: panelItem.media.filter((m) => m.id !== mid) }); }}
            onSave={() => { editSnapshot.current = null; editIsNew.current = false; setEditDirty(false); setPanelMode("read"); }}
            onDelete={() => deleteItem(panelItem.id)}
            onManageCategories={() => panelItem.kind === "shape" ? setManagePathCatsOpen(true) : setManageCatsOpen(true)}
          />
        )}

        {/* Unsaved changes dialog */}
        {unsavedOpen && (
          <div style={s.modalWrap} onClick={() => resolveUnsaved("cancel")}>
            <div style={{ ...s.modalCard, width: 320 }} onClick={(e) => e.stopPropagation()}>
              <div style={s.modalHead}><strong>Unsaved changes</strong></div>
              <div style={{ padding: 16, fontSize: 14, color: C.sub }}>
                You have unsaved changes. Save them before leaving?
              </div>
              <div style={{ display: "flex", gap: 8, padding: 12, borderTop: `1px solid ${C.border}` }}>
                <button style={s.cancelAdd} onClick={() => resolveUnsaved("cancel")}>Cancel</button>
                <button style={{ ...s.deleteBtn, flex: 1 }} onClick={() => resolveUnsaved("discard")}>Discard</button>
                <button style={{ ...s.addBtn, flex: 1 }} onClick={() => resolveUnsaved("save")}>Save</button>
              </div>
            </div>
          </div>
        )}

        {/* Manage categories */}
        {manageCatsOpen && (
          <ManageCategoriesModal
            categories={categories}
            countInCategory={countInCategory}
            onClose={() => setManageCatsOpen(false)}
            onAdd={addCategory}
            onRemove={removeCategory}
            onSetIcon={setCategoryIcon}
          />
        )}

        {managePathCatsOpen && (
          <ManagePathCategoriesModal
            categories={pathCategories}
            countInCategory={countInPathCategory}
            onClose={() => setManagePathCatsOpen(false)}
            onAdd={addPathCategory}
            onRemove={removePathCategory}
            onSetIcon={setPathCategoryIcon}
            onSetColor={setPathCategoryColor}
          />
        )}

        {/* Add-to-notebook picker */}
        {addToNotebookFor && (
          <AddToNotebookModal
            target={addToNotebookFor}
            notebooks={notebooks}
            items={items}
            onClose={() => setAddToNotebookFor(null)}
            onCreateNotebook={createNotebook}
            onAdd={(notebookId, pinId) => addPinToNotebook(notebookId, pinId)}
            onRemove={(notebookId, pinId) => removePinFromNotebook(notebookId, pinId)}
          />
        )}

        {/* Did you go? flow */}
        {didYouGoFor && items.find((it) => it.id === didYouGoFor) && (
          <DidYouGoModal
            item={items.find((it) => it.id === didYouGoFor)}
            onComplete={(payload) => completeWent(didYouGoFor, payload)}
            onClose={() => setDidYouGoFor(null)}
          />
        )}
      </div>

      {/* Floating bottom navigation pill */}
      <div style={s.bottomNav}>
        <button style={{ ...s.bottomTab, ...(view === "map" ? s.bottomTabActive : {}) }} onClick={() => guardNav(() => { setPanelId(null); setView("map"); setTimeout(() => mapRef.current && mapRef.current.invalidateSize(), 50); })}>Map</button>
        <button style={{ ...s.bottomTab, ...(view === "list" ? s.bottomTabActive : {}) }} onClick={() => guardNav(() => { setPanelId(null); setView("list"); })}>List</button>
        <button style={{ ...s.bottomTab, ...(view === "nearby" ? s.bottomTabActive : {}) }} onClick={() => guardNav(() => { setPanelId(null); setView("nearby"); })}>Nearby</button>
        <button style={{ ...s.bottomTab, ...(view === "events" ? s.bottomTabActive : {}) }} onClick={() => guardNav(() => { setPanelId(null); setView("events"); })}>Events</button>
      </div>
    </div>
  );
}

function DidYouGoModal({ item, onComplete, onClose }) {
  const s = makeStyles();
  const [step, setStep] = useState(1); // 1=date, 2=photos, 3=update
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [media, setMedia] = useState([]);
  const [update, setUpdate] = useState("");
  const fileRef = useRef(null);

  function addFiles(files) {
    const arr = Array.from(files);
    Promise.all(arr.map((f) => new Promise((res) => {
      const reader = new FileReader();
      reader.onload = () => res({ id: uid(), type: f.type.startsWith("video") ? "video" : "image", name: f.name, url: reader.result });
      reader.readAsDataURL(f);
    }))).then((m) => setMedia((prev) => [...prev, ...m]));
  }

  function finish() {
    // format date as M/D/YY to match the requested "Update - 12/15/26" style
    let stamp = date;
    if (date) { const d = new Date(date); stamp = `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`; }
    onComplete({ date, media, update, stamp });
  }

  return (
    <div style={s.modalWrap} onClick={onClose}>
      <div style={{ ...s.modalCard, width: 360 }} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalHead}>
          <strong>Did you go to {item.title || "this place"}?</strong>
          <button style={s.iconBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          {step === 1 && (
            <>
              <div style={{ fontSize: 14, color: C.sub }}>When did you go?</div>
              <input type="date" style={s.input} value={date} onChange={(e) => setDate(e.target.value)} />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button style={s.cancelAdd} onClick={onClose}>Cancel</button>
                <button style={s.addBtn} onClick={() => setStep(2)}>Next</button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div style={{ fontSize: 14, color: C.sub }}>Add some photos from your visit (optional).</div>
              {media.length > 0 && (
                <div style={s.mediaGrid}>
                  {media.map((m) => (
                    <div key={m.id} style={s.mediaCell}>
                      {m.type === "video" ? <video src={m.url} style={s.mediaThumb} /> : <img src={m.url} alt={m.name} style={s.mediaThumb} />}
                    </div>
                  ))}
                </div>
              )}
              <input ref={fileRef} type="file" accept="image/*,video/*" multiple style={{ display: "none" }} onChange={(e) => addFiles(e.target.files)} />
              <button style={s.addBtnAlt} onClick={() => fileRef.current && fileRef.current.click()}>+ Add photos</button>
              <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
                <button style={s.cancelAdd} onClick={() => setStep(1)}>Back</button>
                <button style={s.addBtn} onClick={() => setStep(3)}>Next</button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div style={{ fontSize: 14, color: C.sub }}>Add a quick update about your visit. It'll be appended to your notes.</div>
              <textarea style={{ ...s.input, minHeight: 90, resize: "vertical" }} placeholder="How was it?" value={update} onChange={(e) => setUpdate(e.target.value)} />
              <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
                <button style={s.cancelAdd} onClick={() => setStep(2)}>Back</button>
                <button style={s.addBtn} onClick={finish}>Mark as visited ✓</button>
              </div>
            </>
          )}

          <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 4 }}>
            {[1, 2, 3].map((n) => (
              <span key={n} style={{ width: 7, height: 7, borderRadius: "50%", background: n === step ? C.visited : C.border }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ManageCategoriesModal({ categories, countInCategory, onClose, onAdd, onRemove, onSetIcon }) {
  const s = makeStyles();
  const [newName, setNewName] = useState("");
  const [confirmDel, setConfirmDel] = useState(null); // category name pending deletion
  const [moveTo, setMoveTo] = useState("other");
  const [iconFor, setIconFor] = useState(null); // category name whose icon picker is open
  const others = categories.filter((c) => c.name !== confirmDel);

  return (
    <div style={s.modalWrap} onClick={onClose}>
      <div style={s.modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalHead}>
          <strong>Manage categories</strong>
          <button style={s.iconBtn} onClick={onClose}>✕</button>
        </div>

        <div style={s.modalBody}>
          {confirmDel ? (
            <div style={{ padding: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Remove “{catLabel(confirmDel)}”?</div>
              {countInCategory(confirmDel) > 0 ? (
                <>
                  <div style={{ fontSize: 13.5, color: C.sub, marginBottom: 12 }}>
                    {countInCategory(confirmDel)} pin{countInCategory(confirmDel) === 1 ? "" : "s"} use{countInCategory(confirmDel) === 1 ? "s" : ""} this category. Move {countInCategory(confirmDel) === 1 ? "it" : "them"} to:
                  </div>
                  <select style={{ ...s.input, width: "100%", marginBottom: 14 }} value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                    {others.map((c) => <option key={c.name} value={c.name}>{c.icon} {catLabel(c.name)}</option>)}
                  </select>
                </>
              ) : (
                <div style={{ fontSize: 13.5, color: C.sub, marginBottom: 12 }}>No pins use this category.</div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <button style={s.cancelAdd} onClick={() => setConfirmDel(null)}>Cancel</button>
                <button style={{ ...s.deleteBtn, flex: 1 }} onClick={() => { onRemove(confirmDel, moveTo); setConfirmDel(null); }}>Remove category</button>
              </div>
            </div>
          ) : (
            <>
              {categories.map((c) => (
                <div key={c.name}>
                  <div style={s.modalRow}>
                    <button style={s.catIconBtn} onClick={() => setIconFor(iconFor === c.name ? null : c.name)} title="Change icon">{c.icon}</button>
                    <span style={{ flex: 1 }}>{catLabel(c.name)} <span style={{ color: C.sub, fontSize: 12 }}>· {countInCategory(c.name)}</span></span>
                    {c.name === "other"
                      ? <span style={{ color: C.sub, fontSize: 12 }}>Permanent</span>
                      : <button style={s.cityEdit} onClick={() => { setConfirmDel(c.name); setMoveTo((categories.find((x) => x.name !== c.name) || { name: "other" }).name); }}>Remove</button>}
                  </div>
                  {iconFor === c.name && (
                    <div style={s.iconGrid}>
                      {CATEGORY_ICONS.map((emo) => (
                        <button key={emo} style={{ ...s.iconChoice, ...(c.icon === emo ? s.iconChoiceOn : {}) }} onClick={() => { onSetIcon(c.name, emo); setIconFor(null); }}>{emo}</button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>

        {!confirmDel && (
          <div style={s.modalFoot}>
            <input
              style={{ ...s.input, flex: 1 }}
              value={newName}
              placeholder="New category name"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { if (onAdd(newName)) setNewName(""); } }}
            />
            <button style={s.addBtn} onClick={() => { if (onAdd(newName)) setNewName(""); }}>Add</button>
          </div>
        )}
      </div>
    </div>
  );
}

function ManagePathCategoriesModal({ categories, countInCategory, onClose, onAdd, onRemove, onSetIcon, onSetColor }) {
  const s = makeStyles();
  const [newName, setNewName] = useState("");
  const [confirmDel, setConfirmDel] = useState(null);
  const [moveTo, setMoveTo] = useState("other");
  const [editing, setEditing] = useState(null); // category name whose icon/color editor is open
  const others = categories.filter((c) => c.name !== confirmDel);
  return (
    <div style={s.modalWrap} onClick={onClose}>
      <div style={s.modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalHead}>
          <strong>Manage path categories</strong>
          <button style={s.iconBtn} onClick={onClose}>✕</button>
        </div>
        <div style={s.modalBody}>
          {confirmDel ? (
            <div style={{ padding: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Remove “{catLabel(confirmDel)}”?</div>
              {countInCategory(confirmDel) > 0 ? (
                <>
                  <div style={{ fontSize: 13.5, color: C.sub, marginBottom: 12 }}>
                    {countInCategory(confirmDel)} path{countInCategory(confirmDel) === 1 ? "" : "s"} use{countInCategory(confirmDel) === 1 ? "s" : ""} this category. Move {countInCategory(confirmDel) === 1 ? "it" : "them"} to:
                  </div>
                  <select style={{ ...s.input, width: "100%", marginBottom: 14 }} value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                    {others.map((c) => <option key={c.name} value={c.name}>{c.icon} {catLabel(c.name)}</option>)}
                  </select>
                </>
              ) : <div style={{ fontSize: 13.5, color: C.sub, marginBottom: 12 }}>No paths use this category.</div>}
              <div style={{ display: "flex", gap: 8 }}>
                <button style={s.cancelAdd} onClick={() => setConfirmDel(null)}>Cancel</button>
                <button style={{ ...s.deleteBtn, flex: 1 }} onClick={() => { onRemove(confirmDel, moveTo); setConfirmDel(null); }}>Remove category</button>
              </div>
            </div>
          ) : (
            <>
              {categories.map((c) => (
                <div key={c.name}>
                  <div style={s.modalRow}>
                    <button style={{ ...s.catIconBtn, borderColor: c.color }} onClick={() => setEditing(editing === c.name ? null : c.name)} title="Edit icon & color">{c.icon}</button>
                    <span style={{ flex: 1, display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: c.color, display: "inline-block" }} />{catLabel(c.name)} <span style={{ color: C.sub, fontSize: 12 }}>· {countInCategory(c.name)}</span></span>
                    {c.name === "other"
                      ? <span style={{ color: C.sub, fontSize: 12 }}>Permanent</span>
                      : <button style={s.cityEdit} onClick={() => { setConfirmDel(c.name); setMoveTo((categories.find((x) => x.name !== c.name) || { name: "other" }).name); }}>Remove</button>}
                  </div>
                  {editing === c.name && (
                    <div style={{ padding: "4px 12px 12px" }}>
                      <div style={{ fontSize: 12, color: C.sub, margin: "2px 0 4px" }}>Color</div>
                      <div style={s.colorRow}>
                        {PATH_CATEGORY_COLORS.map((col) => (
                          <button key={col} onClick={() => onSetColor(c.name, col)} style={{ ...s.colorDot, background: col, outline: c.color === col ? `2px solid ${C.text}` : "none", outlineOffset: 2 }} />
                        ))}
                      </div>
                      <div style={{ fontSize: 12, color: C.sub, margin: "8px 0 4px" }}>Icon</div>
                      <div style={s.iconGrid}>
                        {CATEGORY_ICONS.map((emo) => (
                          <button key={emo} style={{ ...s.iconChoice, ...(c.icon === emo ? s.iconChoiceOn : {}) }} onClick={() => { onSetIcon(c.name, emo); }}>{emo}</button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
        {!confirmDel && (
          <div style={s.modalFoot}>
            <input style={{ ...s.input, flex: 1 }} value={newName} placeholder="New path category" onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { if (onAdd(newName)) setNewName(""); } }} />
            <button style={s.addBtn} onClick={() => { if (onAdd(newName)) setNewName(""); }}>Add</button>
          </div>
        )}
      </div>
    </div>
  );
}

function AddToNotebookModal({ target, notebooks, items, onClose, onCreateNotebook, onAdd, onRemove }) {
  const s = makeStyles();
  // Case A: adding one pin to a chosen notebook (target.pinId)
  // Case B: adding pins to a chosen notebook (target.notebookId)
  if (target.pinId) {
    const pin = items.find((it) => it.id === target.pinId);
    return (
      <div style={s.modalWrap} onClick={onClose}>
        <div style={s.modalCard} onClick={(e) => e.stopPropagation()}>
          <div style={s.modalHead}>
            <strong>Add “{pin ? (pin.title || "Untitled") : ""}” to…</strong>
            <button style={s.iconBtn} onClick={onClose}>✕</button>
          </div>
          <div style={s.modalBody}>
            {notebooks.length === 0 && <p style={s.sectionEmpty}>No notebooks yet.</p>}
            {notebooks.map((n) => {
              const inIt = n.entries.some((e) => e.pinId === target.pinId);
              return (
                <button key={n.id} style={s.modalRow} onClick={() => inIt ? onRemove(n.id, target.pinId) : onAdd(n.id, target.pinId)}>
                  <span>{n.title || "Untitled notebook"}</span>
                  <span style={{ color: inIt ? C.visited : C.sub, fontWeight: 600 }}>{inIt ? "✓ Added" : "+ Add"}</span>
                </button>
              );
            })}
          </div>
          <div style={s.modalFoot}>
            <button style={s.addBtn} onClick={onCreateNotebook}>+ New notebook</button>
          </div>
        </div>
      </div>
    );
  }
  // Case B
  const nb = notebooks.find((n) => n.id === target.notebookId);
  const pins = items.filter((it) => it.kind === "pin");
  return (
    <div style={s.modalWrap} onClick={onClose}>
      <div style={s.modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalHead}>
          <strong>Add places to “{nb ? (nb.title || "Untitled") : ""}”</strong>
          <button style={s.iconBtn} onClick={onClose}>✕</button>
        </div>
        <div style={s.modalBody}>
          {pins.length === 0 && <p style={s.sectionEmpty}>No pins yet. Add some on the map first.</p>}
          {pins.map((p) => {
            const inIt = nb && nb.entries.some((e) => e.pinId === p.id);
            return (
              <button key={p.id} style={s.modalRow} onClick={() => inIt ? onRemove(target.notebookId, p.id) : onAdd(target.notebookId, p.id)}>
                <span>{p.title || "Untitled"} {p.city ? <span style={{ color: C.sub }}>· {p.city}</span> : null}</span>
                <span style={{ color: inIt ? C.visited : C.sub, fontWeight: 600 }}>{inIt ? "✓ Added" : "+ Add"}</span>
              </button>
            );
          })}
        </div>
        <div style={s.modalFoot}>
          <button style={s.cancelAdd} onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function ListSection({ title, color, rows, userPos, onClick, onFav, hideHead, categories, pathCategories, onDidYouGo }) {
  const s = makeStyles();
  return (
    <div style={s.section}>
      {!hideHead && (
        <div style={s.sectionHead}>
          <span style={{ ...s.dot, background: color }} />
          <h3 style={s.sectionTitle}>{title}</h3>
          <span style={s.countPill}>{rows.length}</span>
        </div>
      )}
      {rows.length === 0 && !hideHead && <p style={s.sectionEmpty}>Nothing here yet.</p>}
      <div style={s.cards}>
        {rows.map((it) => {
          const stColor = it.status === STATUS.VISITED ? C.pinVisited : C.pinWishlist;
          let dist = null;
          if (userPos) { const co = itemCoord(it); if (co) dist = distanceKm(userPos, co); }
          return (
            <div key={it.id} style={s.cardWrap}>
              <button style={s.card} onClick={() => onClick(it)}>
                {(() => {
                  const photos = (it.media || []).filter((m) => m.type !== "video");
                  return photos.length > 0 ? (
                    <div style={s.cardImgStrip}>
                      {photos.map((m) => <img key={m.id} src={m.url} alt="" style={s.cardImg} />)}
                    </div>
                  ) : (
                    <div style={s.cardImgPlaceholder}>
                      <span style={s.placeholderMark}>{it.kind === "pin" ? "◉" : "／"}</span>
                    </div>
                  );
                })()}
                <div style={s.cardBody}>
                  <div style={s.cardTitle}>{it.title || "Untitled"}</div>
                  <div style={s.cardMeta}>{it.kind === "pin"
                    ? `${iconFor(categories || [], it.category)} ${catLabel(it.category)}`
                    : `${iconFor(pathCategories || [], it.category)} ${catLabel(it.category)}`}</div>
                  {(it.description || it.note) && <div style={s.cardNote}>{it.description || it.note}</div>}
                  <div style={s.chipRow}>
                    {dist != null && <span style={{ ...s.chip, color: "#185FA5", borderColor: "#185FA5" }}>{formatKm(dist)}</span>}
                    {it.city && <span style={s.chip}>{it.city}</span>}
                    {it.date && <span style={s.chip}>{it.date}</span>}
                    {it.hidden && <span style={{ ...s.chip, color: C.sub }}>Hidden on map</span>}
                  </div>
                </div>
              </button>
              {onDidYouGo && it.status === STATUS.WISHLIST && it.kind === "pin" && (
                <button style={s.cardWentBtn} onClick={(e) => { e.stopPropagation(); onDidYouGo(it.id); }}>✓ Did you go?</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NotebookView({ notebook, items, onBack, onChange, onDelete, onOpenAdd, onCaption, onRemove, onOpenPin }) {
  const s = makeStyles();
  if (!notebook) return null;
  const entryItems = notebook.entries
    .map((e) => ({ entry: e, item: items.find((it) => it.id === e.pinId) }))
    .filter((x) => x.item);
  return (
    <div>
      <div style={s.nbHeadRow}>
        <button style={s.nbBack} onClick={onBack}>← Notebooks</button>
        <button style={s.nbDelete} onClick={onDelete}>Delete</button>
      </div>
      <input
        style={s.nbTitle}
        value={notebook.title}
        placeholder="Notebook title"
        onChange={(e) => onChange({ title: e.target.value })}
      />
      <textarea
        style={s.nbDesc}
        rows={2}
        value={notebook.description}
        placeholder="Add a description…"
        onChange={(e) => onChange({ description: e.target.value })}
      />

      <div style={{ ...s.sectionHead, justifyContent: "space-between", marginTop: 8 }}>
        <span style={s.sectionTitle}>{entryItems.length} place{entryItems.length === 1 ? "" : "s"}</span>
        <button style={s.addBtn} onClick={onOpenAdd}>+ Add locations</button>
      </div>

      {entryItems.length === 0 && <p style={s.sectionEmpty}>No places yet. Tap “Add locations” to put pins in this notebook.</p>}

      <div style={s.cards}>
        {entryItems.map(({ entry, item }) => (
          <div key={item.id} style={s.nbCard}>
            <div style={s.cardTop}>
              <button style={s.nbCardTitle} onClick={() => onOpenPin(item.id)}>{item.title || "Untitled"}</button>
              <button style={s.nbRemove} onClick={() => onRemove(item.id)} aria-label="Remove">✕</button>
            </div>
            <div style={s.chipRow}>
              {item.kind === "pin" && <span style={s.chip}>{catLabel(item.category)}</span>}
              {item.city && <span style={s.chip}>{item.city}</span>}
            </div>
            <textarea
              style={s.nbCaption}
              rows={2}
              value={entry.caption}
              placeholder="Add a caption for this place…"
              onChange={(e) => onCaption(item.id, e.target.value)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function TransitPanel({ stop, onClose, onChange, onDelete, onShowOnMap }) {
  const s = makeStyles();
  const nameEmpty = !stop.name || !stop.name.trim();
  const isCustom = !TRANSIT_COLORS.some((c) => c.color === stop.color);
  return (
    <div style={s.editor}>
      <div style={s.editorHead}>
        <strong style={s.editorKind}>{transitType(stop.type).icon} {transitType(stop.type).label} stop</strong>
        <button style={s.iconBtn} onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div style={s.editorBody}>
        <label style={s.label}>Stop name <span style={{ color: C.wishlist }}>*</span></label>
        <input style={{ ...s.input, ...(nameEmpty ? s.inputError : {}) }} value={stop.name} placeholder="e.g. Ayala Station" onChange={(e) => onChange({ name: e.target.value })} autoFocus />

        <label style={s.label}>Type</label>
        <div style={s.typeRow}>
          {TRANSIT_TYPES.map((tt) => (
            <button
              key={tt.id}
              style={{ ...s.typeBtn, ...((stop.type || "rail") === tt.id ? s.typeBtnOn : {}) }}
              onClick={() => onChange({ type: tt.id })}
            >{tt.icon} {tt.label}</button>
          ))}
        </div>

        <label style={s.label}>Line</label>
        <input style={s.input} value={stop.line} placeholder="e.g. MRT-3" onChange={(e) => onChange({ line: e.target.value })} />
        <span style={s.fieldNote}>Stops sharing a line name and color group together visually.</span>

        <label style={s.label}>Line color</label>
        <div style={s.colorRow}>
          {TRANSIT_COLORS.map((c) => (
            <button
              key={c.color}
              title={c.name}
              onClick={() => onChange({ color: c.color })}
              style={{ ...s.colorDot, background: c.color, outline: stop.color === c.color ? `2px solid ${C.text}` : "none", outlineOffset: 2 }}
            />
          ))}
          <label style={{ ...s.colorDot, background: isCustom ? stop.color : "#fff", border: `1px dashed ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", position: "relative" }} title="Custom color">
            <span style={{ fontSize: 12, color: isCustom ? "#fff" : C.sub }}>+</span>
            <input type="color" value={stop.color} onChange={(e) => onChange({ color: e.target.value })} style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} />
          </label>
        </div>
      </div>
      <div style={s.editorFoot}>
        <button style={s.locateBtn} onClick={onShowOnMap}>Show on map</button>
        <button style={s.deleteBtn} onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}

function EventPanel({ event, onClose, onChange, onAddress, onAddMedia, onRemoveMedia, onDelete, onShowOnMap }) {
  const s = makeStyles();
  const fileRef = useRef(null);
  const cd = countdown(event);
  const titleEmpty = !event.title || !event.title.trim();
  const allDay = !!event.allDay;
  const mode = event.mode || "single";
  const dtType = allDay ? "date" : "datetime-local";
  const dates = Array.isArray(event.dates) ? event.dates : [];
  const setDateAt = (i, val) => { const next = dates.slice(); next[i] = val; onChange({ dates: next }); };
  const addDate = () => onChange({ dates: [...dates, ""] });
  const removeDate = (i) => onChange({ dates: dates.filter((_, idx) => idx !== i) });
  const cdBg = cd.ongoing ? C.visited : (cd.past ? "#9A9A95" : "#C0392B");
  return (
    <div style={s.editor}>
      <div style={s.editorHead}>
        <strong style={s.editorKind}>🚩 Event</strong>
        <button style={s.iconBtn} onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div style={s.editorBody}>
        <div style={{ ...s.eventCountdown, background: cdBg }}>
          {cd.ongoing ? "Happening now" : cd.past ? "This event has passed" : (cd.text ? `In ${cd.text}` : "Set a date to start the countdown")}
        </div>

        <label style={s.label}>Event name <span style={{ color: C.wishlist }}>*</span></label>
        <input style={{ ...s.input, ...(titleEmpty ? s.inputError : {}) }} value={event.title} placeholder="What's the event?" onChange={(e) => onChange({ title: e.target.value })} autoFocus />

        <label style={s.label}>Venue / address</label>
        <input style={s.input} value={event.venue} placeholder="Type the venue or address" onChange={(e) => onAddress(e.target.value)} />
        <span style={s.fieldNote}>The flag is placed from this address (geocoded in the live build; uses your location/map center here).</span>

        <label style={s.checkRow}>
          <input type="checkbox" checked={allDay} onChange={(e) => onChange({ allDay: e.target.checked })} />
          <span>All-day event</span>
        </label>

        <label style={s.label}>When</label>
        <div style={s.segment}>
          <button style={{ ...s.segBtn, ...(mode === "single" ? { background: C.shape, color: "#fff" } : {}) }} onClick={() => onChange({ mode: "single" })}>One date</button>
          <button style={{ ...s.segBtn, ...(mode === "range" ? { background: C.shape, color: "#fff" } : {}) }} onClick={() => onChange({ mode: "range" })}>Range</button>
          <button style={{ ...s.segBtn, ...(mode === "multi" ? { background: C.shape, color: "#fff" } : {}) }} onClick={() => onChange({ mode: "multi", dates: dates.length ? dates : [""] })}>Multiple</button>
        </div>

        {mode === "single" && (
          <input type={dtType} style={{ ...s.input, marginTop: 6 }} value={event.datetime} onChange={(e) => onChange({ datetime: e.target.value })} />
        )}
        {mode === "range" && (
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <div style={s.col}><span style={s.fieldNote}>Start</span><input type={dtType} style={s.input} value={event.startDate} onChange={(e) => onChange({ startDate: e.target.value })} /></div>
            <div style={s.col}><span style={s.fieldNote}>End</span><input type={dtType} style={s.input} value={event.endDate} onChange={(e) => onChange({ endDate: e.target.value })} /></div>
          </div>
        )}
        {mode === "multi" && (
          <div style={{ marginTop: 6 }}>
            {dates.map((d, i) => (
              <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                <input type={dtType} style={{ ...s.input, flex: 1 }} value={d} onChange={(e) => setDateAt(i, e.target.value)} />
                {dates.length > 1 && <button style={s.iconBtn} onClick={() => removeDate(i)} aria-label="Remove date">✕</button>}
              </div>
            ))}
            <button style={s.addMediaBtn} onClick={addDate}>+ Add another date</button>
          </div>
        )}

        <label style={s.label}>Photos (optional)</label>
        <input ref={fileRef} type="file" accept="image/*,video/*" multiple style={{ display: "none" }} onChange={(e) => { onAddMedia(e.target.files); e.target.value = ""; }} />
        <button style={s.addMediaBtn} onClick={() => fileRef.current && fileRef.current.click()}>+ Add photos</button>
        {event.media.length > 0 && (
          <div style={s.mediaGrid}>
            {event.media.map((m) => (
              <div key={m.id} style={s.mediaCell}>
                {m.type === "video" ? <video src={m.url} style={s.mediaThumb} controls /> : <img src={m.url} alt={m.name} style={s.mediaThumb} />}
                <button style={s.mediaDel} onClick={() => onRemoveMedia(m.id)} aria-label="Remove">✕</button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={s.editorFoot}>
        <button style={s.locateBtn} onClick={onShowOnMap}>Show on map</button>
        <button style={s.deleteBtn} onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}

function ReadPanel({ item, onClose, onEdit, onToggleHidden, onLocate, onAddToNotebook, onToggleFavorite, onDidYouGo }) {
  const s = makeStyles();
  const stColor = item.status === STATUS.VISITED ? C.pinVisited : C.pinWishlist;
  const stText = item.status === STATUS.VISITED ? "Been there" : "Want to go";
  const titleEmpty = !item.title || !item.title.trim();

  const miniRef = useRef(null);
  const miniMap = useRef(null);
  const [place, setPlace] = useState(undefined); // undefined=loading, null=none, object=data
  const coord = itemCoord(item);

  // mini map for this item
  useEffect(() => {
    if (!coord || !window.L || !miniRef.current) return;
    if (miniMap.current) { miniMap.current.remove(); miniMap.current = null; }
    const L = window.L;
    const m = L.map(miniRef.current, { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, tap: false });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(m);
    if (item.kind === "pin") { m.setView([coord.lat, coord.lng], 15); L.marker([coord.lat, coord.lng]).addTo(m); }
    else { const line = L.polyline(item.path, { color: C.shape, weight: 4 }).addTo(m); m.fitBounds(line.getBounds(), { padding: [20, 20] }); }
    miniMap.current = m;
    setTimeout(() => m.invalidateSize(), 60);
    return () => { if (miniMap.current) { miniMap.current.remove(); miniMap.current = null; } };
    // eslint-disable-next-line
  }, [item.id]);

  // google place details (stub here; live in cloud build)
  useEffect(() => {
    let on = true;
    setPlace(undefined);
    if (coord) {
      fetchPlaceDetails({ lat: coord.lat, lng: coord.lng, title: item.title }).then((d) => { if (on) setPlace(d); });
    } else setPlace(null);
    return () => { on = false; };
    // eslint-disable-next-line
  }, [item.id]);

  return (
    <div style={s.editor}>
      <div style={s.editorHead}>
        <strong style={s.editorKind}>{item.kind === "pin" ? "Pin" : "Path"}</strong>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button
            style={{ ...s.headIconBtn, ...(item.hidden ? s.headIconBtnOff : {}) }}
            onClick={onToggleHidden}
            aria-label={item.hidden ? "Hidden on map — tap to show" : "Shown on map — tap to hide"}
            title={item.hidden ? "Hidden on map — tap to show" : "Shown on map — tap to hide"}
          >
            {item.hidden
              ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M6.61 6.61A18.5 18.5 0 0 0 2 12s3 8 10 8a9.12 9.12 0 0 0 5.39-1.61"/><path d="M14.12 14.12A3 3 0 1 1 9.88 9.88"/><line x1="2" y1="2" x2="22" y2="22"/></svg>
              : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8z"/><circle cx="12" cy="12" r="3"/></svg>}
          </button>
          <button style={{ ...s.favBtn, ...(item.favorite ? s.favBtnOn : {}) }} onClick={onToggleFavorite} aria-label="Favorite">{item.favorite ? "★" : "☆"}</button>
          <button style={s.iconBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>
      </div>

      <div style={s.editorBody}>
        <div style={s.readTitle}>{item.title || "Untitled"}</div>

        {item.description && <div style={s.readDesc}>{item.description}</div>}

        {item.media.length > 0 && (
          <div style={s.mediaGrid}>
            {item.media.map((m) => (
              <div key={m.id} style={s.mediaCell}>
                {m.type === "video"
                  ? <video src={m.url} style={s.mediaThumb} controls />
                  : <img src={m.url} alt={m.name} style={s.mediaThumb} />}
              </div>
            ))}
          </div>
        )}

        <div style={s.chipRow}>
          <span style={{ ...s.chip, background: stColor, borderColor: stColor, color: "#fff" }}>{stText}</span>
          <span style={s.chip}>{catLabel(item.category)}</span>
          {item.city && <span style={s.chip}>{item.city}</span>}
          {item.date && <span style={s.chip}>Visited {item.date}</span>}
        </div>

        {onDidYouGo && (
          <button style={s.didYouGoBtn} onClick={onDidYouGo}>✓ Did you go? Mark as visited</button>
        )}

        {/* mini map */}
        {coord && (
          <>
            <div style={s.readLabel}>Location</div>
            <div ref={miniRef} style={s.miniMap} />
            <button style={s.miniMapBtn} onClick={onLocate}>View on full map</button>
          </>
        )}

        {item.note && (
          <>
            <div style={s.readLabel}>Notes</div>
            <div style={s.readNote}>{item.note}</div>
          </>
        )}

        {onAddToNotebook && (
          <button style={s.notebookBtn} onClick={onAddToNotebook}>📓 Add to notebook</button>
        )}

        {/* Google Maps */}
        {coord && (
          <>
            <div style={s.readLabel}>Google Maps</div>
            <a
              style={s.googleBtn}
              href={googleMapsUrl(coord.lat, coord.lng, item.title)}
              target="_blank"
              rel="noopener noreferrer"
            >View on Google Maps ↗</a>
            <div style={s.googleDetails}>
              {place === undefined && <div style={s.googleMsg}>Loading place details…</div>}
              {place === null && <div style={s.googleMsg}>Google listing details (rating, reviews, photos) appear here in the live build, loaded from the Places API.</div>}
              {place && (
                <div>
                  {place.rating != null && <div style={s.googleRating}>★ {place.rating} {place.totalRatings ? `(${place.totalRatings})` : ""}</div>}
                  {place.photos && place.photos.length > 0 && (
                    <div style={s.thumbRow}>{place.photos.slice(0, 4).map((u, i) => <img key={i} src={u} alt="" style={s.thumb} />)}</div>
                  )}
                  {place.reviews && place.reviews.map((r, i) => (
                    <div key={i} style={s.review}><strong>{r.author}</strong> · ★ {r.rating}<div style={s.reviewText}>{r.text}</div></div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {titleEmpty && <div style={s.readHint}>This item has no title yet. Tap Edit to add one.</div>}
      </div>

      <div style={s.editorFoot}>
        <button style={s.locateBtn} onClick={onLocate}>View on full map</button>
        <button style={s.editBtn} onClick={onEdit}>Edit</button>
      </div>
    </div>
  );
}

function EditPanel({ item, categories, onChange, onAddMedia, onRemoveMedia, onSave, onDelete, onManageCategories }) {
  const s = makeStyles();
  const fileRef = useRef(null);
  const titleEmpty = !item.title || !item.title.trim();
  // city auto-populates from location; show read-only with Edit unless empty or being edited
  const [cityEditing, setCityEditing] = useState(!item.city);
  useEffect(() => { setCityEditing(!item.city); }, [item.id]); // reset when switching items

  return (
    <div style={s.editor}>
      <div style={s.editorHead}>
        <strong style={s.editorKind}>{item.kind === "pin" ? "Edit pin" : "Edit path"}</strong>
      </div>

      <div style={s.editorBody}>
        <label style={s.label}>Title <span style={{ color: C.wishlist }}>*</span></label>
        <input
          style={{ ...s.input, ...(titleEmpty ? s.inputError : {}) }}
          value={item.title}
          placeholder="Required — name this place"
          onChange={(e) => onChange({ title: e.target.value })}
          autoFocus
        />
        {titleEmpty && <span style={s.errText}>A title is required to save.</span>}

        <label style={s.label}>Description</label>
        <input style={s.input} value={item.description || ""} placeholder="Short description" onChange={(e) => onChange({ description: e.target.value })} />

        <div style={s.row}>
          <div style={s.col}>
            <label style={s.label}>Category <button style={s.manageLink} onClick={onManageCategories} type="button">Manage</button></label>
            <select style={s.input} value={item.category} onChange={(e) => onChange({ category: e.target.value })}>
              {categories.map((c) => <option key={c.name} value={c.name}>{c.icon} {catLabel(c.name)}</option>)}
            </select>
          </div>
          <div style={s.col}>
            <label style={s.label}>City {item.city && !cityEditing && <span style={s.autoTag}>auto</span>}</label>
            {cityEditing ? (
              <input
                style={s.input}
                value={item.city}
                placeholder="Type the city"
                autoFocus={!item.city ? false : true}
                onChange={(e) => onChange({ city: e.target.value })}
                onBlur={() => { if (item.city && item.city.trim()) setCityEditing(false); }}
              />
            ) : (
              <div style={s.cityRead}>
                <span>{item.city}</span>
                <button style={s.cityEdit} onClick={() => setCityEditing(true)}>Edit</button>
              </div>
            )}
          </div>
        </div>

        <label style={s.label}>Status</label>
        <div style={s.segment}>
          <button
            style={{ ...s.segBtn, ...(item.status === STATUS.VISITED ? { background: C.pinVisited, color: "#fff" } : {}) }}
            onClick={() => onChange({ status: STATUS.VISITED })}
          >✓ Been there</button>
          <button
            style={{ ...s.segBtn, ...(item.status === STATUS.WISHLIST ? { background: C.pinWishlist, color: "#fff" } : {}) }}
            onClick={() => onChange({ status: STATUS.WISHLIST, date: "" })}
          >★ Want to go</button>
        </div>

        {item.status === STATUS.VISITED && (
          <>
            <label style={s.label}>Date visited</label>
            <input type="date" style={s.input} value={item.date} onChange={(e) => onChange({ date: e.target.value })} />
          </>
        )}

        <label style={s.label}>Notes</label>
        <textarea
          style={s.textarea}
          rows={4}
          value={item.note}
          placeholder="What happened here? What do you want to remember?"
          onChange={(e) => onChange({ note: e.target.value })}
        />

        <label style={s.label}>Photos & videos</label>
        <input ref={fileRef} type="file" accept="image/*,video/*" multiple style={{ display: "none" }}
          onChange={(e) => { onAddMedia(e.target.files); e.target.value = ""; }} />
        <button style={s.addMediaBtn} onClick={() => fileRef.current && fileRef.current.click()}>
          + Add photos / videos
        </button>
        {item.media.length > 0 && (
          <div style={s.mediaGrid}>
            {item.media.map((m) => (
              <div key={m.id} style={s.mediaCell}>
                {m.type === "video"
                  ? <video src={m.url} style={s.mediaThumb} controls />
                  : <img src={m.url} alt={m.name} style={s.mediaThumb} />}
                <button style={s.mediaDel} onClick={() => onRemoveMedia(m.id)} aria-label="Remove">✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={s.editorFoot}>
        <button
          style={{ ...s.saveBtn, ...(titleEmpty ? s.saveDisabled : {}) }}
          onClick={() => { if (!titleEmpty) onSave(); }}
          disabled={titleEmpty}
        >Save</button>
        <button style={s.deleteBtn} onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}

function makeStyles() {
  return {
    app: { display: "flex", flexDirection: "column", height: "100vh", width: "100%", fontFamily: "system-ui, sans-serif", background: C.bg, color: C.text, overflow: "hidden" },
    header: { position: "absolute", top: 0, left: 0, right: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", background: "transparent", zIndex: 700, pointerEvents: "none" },
    brand: { display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 18, color: "#fff", textShadow: "0 2px 6px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.85), 0 0 16px rgba(0,0,0,0.7), 0 1px 2px rgba(0,0,0,0.95)", pointerEvents: "auto" },
    brandOnLight: { color: C.text, textShadow: "none" },
    logoDot: { width: 12, height: 12, borderRadius: "50% 50% 50% 0", background: C.visited, transform: "rotate(-45deg)", boxShadow: "0 1px 3px rgba(0,0,0,0.4)" },
    tabs: { display: "flex", gap: 4, pointerEvents: "auto", zIndex: 750, position: "relative" },
    signOutBtn: { border: "none", background: "rgba(255,255,255,0.95)", color: C.text, padding: "7px 14px", borderRadius: 999, cursor: "pointer", fontSize: 13, fontWeight: 600, boxShadow: "0 2px 8px rgba(0,0,0,0.25)", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 },
    tab: { border: "none", background: "transparent", padding: "6px 16px", borderRadius: 8, cursor: "pointer", fontSize: 14, color: C.sub },
    tabActive: { background: C.card, color: C.text, fontWeight: 600, boxShadow: "0 1px 2px rgba(0,0,0,0.08)" },
    bottomNav: { position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)", display: "inline-flex", gap: 4, background: "#fff", padding: 5, borderRadius: 999, boxShadow: "0 4px 18px rgba(0,0,0,0.18)", border: `1px solid ${C.border}`, zIndex: 900 },
    bottomTab: { border: "none", background: "transparent", padding: "8px 18px", borderRadius: 999, cursor: "pointer", fontSize: 13.5, fontWeight: 600, color: C.sub },
    bottomTabActive: { background: C.visited, color: "#fff" },
    body: { flex: 1, position: "relative", display: "flex", overflow: "hidden", minHeight: 0 },
    mapWrap: { flex: 1, flexDirection: "column", position: "relative", minHeight: 0, height: "100%" },
    fabRow: { position: "absolute", bottom: 84, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 16, zIndex: 600, alignItems: "center" },
    fab: { width: 52, height: 52, borderRadius: "50%", border: `1px solid ${C.border}`, background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 3px 10px rgba(0,0,0,0.18)", padding: 0 },
    fabActive: { borderColor: "#185FA5", boxShadow: "0 0 0 3px rgba(24,95,165,0.35), 0 3px 10px rgba(0,0,0,0.18)" },
    fabGlyph: { fontSize: 24, lineHeight: 1, color: C.text },
    searchPanel: { position: "absolute", bottom: 148, left: 12, right: 12, zIndex: 650, maxWidth: 520, marginLeft: "auto", marginRight: "auto" },
    searchForm: { display: "flex", alignItems: "center", gap: 6, border: `1px solid ${C.border}`, borderRadius: 26, padding: "5px 6px 5px 14px", background: "#fff", boxShadow: "0 4px 16px rgba(0,0,0,0.14)" },
    searchIcon: { fontSize: 18, color: C.sub, lineHeight: 1 },
    searchInput: { flex: 1, border: "none", outline: "none", fontSize: 14, fontFamily: "inherit", background: "transparent", color: C.text },
    searchClear: { border: "none", background: "transparent", color: C.sub, cursor: "pointer", fontSize: 13, padding: "2px 4px" },
    searchGo: { border: "none", background: C.text, color: "#fff", borderRadius: 18, padding: "8px 16px", cursor: "pointer", fontSize: 13, fontWeight: 600 },
    searchClose: { border: "none", background: "transparent", color: C.sub, cursor: "pointer", fontSize: 15, padding: "2px 6px" },
    searchResults: { background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, marginTop: 6, boxShadow: "0 6px 20px rgba(0,0,0,0.12)", overflow: "hidden" },
    searchMsg: { padding: "12px 14px", fontSize: 13, color: C.sub },
    searchResult: { display: "block", width: "100%", textAlign: "left", border: "none", borderBottom: `1px solid ${C.border}`, background: "#fff", padding: "10px 14px", cursor: "pointer" },
    searchResultName: { fontSize: 14, fontWeight: 600, color: C.text },
    searchResultAddr: { fontSize: 12.5, color: C.sub, marginTop: 2 },
    snapMsg: { position: "absolute", bottom: 92, left: 12, right: 12, maxWidth: 420, margin: "0 auto", background: C.wishlist, color: "#fff", padding: "10px 36px 10px 14px", borderRadius: 12, fontSize: 13, zIndex: 650, boxShadow: "0 4px 16px rgba(0,0,0,0.18)" },
    snapMsgClose: { position: "absolute", top: 8, right: 10, border: "none", background: "transparent", color: "#fff", cursor: "pointer", fontSize: 14 },
    mapToolbar: { position: "absolute", top: 12, left: 12, right: 12, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, zIndex: 600, flexWrap: "nowrap", pointerEvents: "none" },
    toolHint: { position: "absolute", top: 14, left: "50%", transform: "translateX(-50%)", fontSize: 12.5, color: C.text, background: "#fff", padding: "6px 12px", borderRadius: 20, boxShadow: "0 2px 8px rgba(0,0,0,0.12)", border: `1px solid ${C.border}`, pointerEvents: "auto", zIndex: 710, whiteSpace: "nowrap", maxWidth: "60%", overflow: "hidden", textOverflow: "ellipsis" },
    toolBtns: { display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end", pointerEvents: "auto", marginLeft: "auto" },
    filterWrap: { position: "relative" },
    filterToggle: { border: `1px solid ${C.border}`, background: C.card, color: C.text, padding: "7px 12px", borderRadius: 999, cursor: "pointer", fontSize: 13, fontWeight: 600 },
    filterToggleActive: { borderColor: C.shape, color: C.shape },
    catMenu: { position: "absolute", top: "100%", right: 0, marginTop: 4, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: "0 6px 20px rgba(0,0,0,0.14)", padding: 8, minWidth: 200, maxHeight: 360, overflowY: "auto", zIndex: 800 },
    accHeader: { display: "flex", alignItems: "center", gap: 8, padding: "4px 4px" },
    accTitleBtn: { flex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", border: "none", background: "transparent", cursor: "pointer", fontSize: 13.5, color: C.text, padding: "2px 0" },
    accChevron: { color: C.sub, fontSize: 12 },
    catMenuHead: { display: "flex", gap: 12, padding: "4px 8px 8px", borderBottom: `1px solid ${C.border}`, marginBottom: 4 },
    catMenuLink: { border: "none", background: "transparent", color: C.shape, cursor: "pointer", fontSize: 12.5, fontWeight: 600, padding: 0 },
    catRow: { display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", fontSize: 13.5, cursor: "pointer", borderRadius: 6 },
    catMenuDivider: { height: 1, background: C.border, margin: "6px 4px" },
    addBtn: { border: "none", background: C.visited, color: "#fff", padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 },
    addBtnAlt: { border: `1px solid ${C.shape}`, background: C.card, color: C.shape, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 },
    addBtnEvent: { border: `1px solid #C0392B`, background: C.card, color: "#C0392B", padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 },
    addBtnTransit: { border: `1px solid #2C6FB7`, background: C.card, color: "#2C6FB7", padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 },
    colorRow: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 4 },
    typeRow: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 4 },
    typeBtn: { border: `1px solid ${C.border}`, background: C.card, color: C.text, padding: "8px 6px", borderRadius: 8, cursor: "pointer", fontSize: 13 },
    typeBtnOn: { background: C.shape, color: "#fff", borderColor: C.shape },
    colorDot: { width: 28, height: 28, borderRadius: "50%", border: "none", cursor: "pointer", padding: 0 },
    stationRow: { display: "flex", alignItems: "center", gap: 8, marginTop: 6 },
    stationDot: { width: 12, height: 12, borderRadius: "50%", background: "#fff", border: "3px solid", flex: "0 0 auto" },
    stationBtns: { display: "flex", gap: 2, alignItems: "center" },
    stationMove: { border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", borderRadius: 6, width: 26, height: 30, fontSize: 13, padding: 0 },
    stationDel: { border: "none", background: "transparent", color: C.sub, cursor: "pointer", fontSize: 14, padding: "0 4px" },
    eventsBox: { position: "absolute", top: 48, left: 12, width: 220, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: "0 4px 16px rgba(0,0,0,0.14)", padding: 10, zIndex: 550 },
    eventsBoxTitle: { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: C.sub, marginBottom: 6 },
    eventsBoxRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, width: "100%", border: "none", background: "transparent", cursor: "pointer", padding: "6px 0", borderTop: `1px solid ${C.border}`, textAlign: "left" },
    eventsBoxName: { fontSize: 13, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    eventsBoxCd: { fontSize: 12, fontWeight: 700, color: "#C0392B", whiteSpace: "nowrap" },
    eventCountdown: { color: "#fff", borderRadius: 10, padding: "12px", textAlign: "center", fontWeight: 700, fontSize: 15, marginBottom: 6 },
    fieldNote: { fontSize: 11.5, color: C.sub, marginTop: 2 },
    checkRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer", marginTop: 12, color: C.text },
    cancelAdd: { border: `1px solid ${C.border}`, background: C.card, color: C.sub, padding: "7px 14px", borderRadius: 999, cursor: "pointer", fontSize: 13 },
    divider: { width: 1, height: 18, background: C.border, display: "inline-block" },
    drawBanner: { position: "absolute", top: 52, left: "50%", transform: "translateX(-50%)", background: C.shape, color: "#fff", padding: "6px 14px", borderRadius: 20, fontSize: 12.5, zIndex: 500, boxShadow: "0 2px 8px rgba(0,0,0,0.2)", maxWidth: "90%", textAlign: "center" },
    map: { position: "absolute", inset: 0, width: "100%", height: "100%" },
    viewSwitcher: { position: "absolute", bottom: 96, right: 10, zIndex: 540, display: "inline-flex", flexDirection: "column", gap: 0, background: "#fff", borderRadius: 4, padding: 0, boxShadow: "0 1px 5px rgba(0,0,0,0.4)", overflow: "hidden", border: "2px solid rgba(0,0,0,0.2)" },
    viewBtn: { border: "none", borderBottom: "1px solid #ccc", background: "#fff", width: 30, height: 30, cursor: "pointer", color: C.sub, display: "flex", alignItems: "center", justifyContent: "center", padding: 0 },
    viewBtnOn: { background: C.shape, color: "#fff" },
    loading: { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: C.sub },
    listWrap: { flex: 1, overflowY: "auto", padding: "56px 20px 88px" },
    modeToggle: { display: "inline-flex", gap: 4, background: C.bg, padding: 3, borderRadius: 10, marginBottom: 16 },
    listTopRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 },
    listSearchToggle: { border: `1px solid ${C.border}`, background: C.card, color: C.text, width: 38, height: 38, borderRadius: 10, cursor: "pointer", fontSize: 18, marginBottom: 16 },
    listSearchBox: { display: "flex", alignItems: "center", gap: 6, border: `1px solid ${C.border}`, borderRadius: 20, padding: "4px 6px 4px 12px", background: "#fff", marginBottom: 16, flex: 1, maxWidth: 280 },
    listSearchInput: { flex: 1, border: "none", outline: "none", fontSize: 14, fontFamily: "inherit", background: "transparent", color: C.text },
    searchSummary: { fontSize: 13, color: C.sub, margin: "0 0 12px" },
    modeBtn: { border: "none", background: "transparent", padding: "6px 16px", borderRadius: 8, cursor: "pointer", fontSize: 13.5, color: C.sub, fontWeight: 600 },
    modeBtnOn: { background: C.card, color: C.text, boxShadow: "0 1px 2px rgba(0,0,0,0.08)" },
    journalIcon: { fontSize: 16, lineHeight: 1 },
    sectionAction: { marginLeft: "auto", border: "none", background: "transparent", color: C.shape, cursor: "pointer", fontSize: 12.5, fontWeight: 600 },
    inlineLink: { border: "none", background: "transparent", color: C.shape, cursor: "pointer", fontSize: 13, padding: 0, textDecoration: "underline" },
    notebookBtn: { marginTop: 10, border: `1px solid ${C.shape}`, background: "#fff", color: C.shape, padding: "10px", borderRadius: 8, cursor: "pointer", fontSize: 13.5, fontWeight: 600 },
    didYouGoBtn: { marginTop: 4, border: "none", background: C.pinVisited, color: "#fff", padding: "11px", borderRadius: 999, cursor: "pointer", fontSize: 13.5, fontWeight: 700, width: "100%" },
    cardWentBtn: { marginTop: 6, border: `1px solid ${C.pinVisited}`, background: "#fff", color: C.pinVisited, padding: "7px", borderRadius: 999, cursor: "pointer", fontSize: 12.5, fontWeight: 700, width: "100%" },
    nbHeadRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
    nbBack: { border: "none", background: "transparent", color: C.text, cursor: "pointer", fontSize: 14, fontWeight: 600, padding: 0 },
    nbDelete: { border: `1px solid ${C.border}`, background: C.card, color: C.wishlist, padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontSize: 13 },
    nbTitle: { width: "100%", boxSizing: "border-box", border: "none", borderBottom: `2px solid ${C.border}`, fontSize: 20, fontWeight: 700, padding: "6px 2px", outline: "none", background: "transparent", color: C.text, fontFamily: "inherit", marginBottom: 8 },
    nbDesc: { width: "100%", boxSizing: "border-box", border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px", fontSize: 13.5, fontFamily: "inherit", resize: "vertical", outline: "none", background: C.card, color: C.text },
    nbCard: { border: `1px solid ${C.border}`, background: C.card, borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 6 },
    nbCardTitle: { border: "none", background: "transparent", textAlign: "left", fontSize: 15, fontWeight: 600, color: C.text, cursor: "pointer", padding: 0, textDecoration: "underline" },
    nbRemove: { border: "none", background: "transparent", color: C.sub, cursor: "pointer", fontSize: 14 },
    nbCaption: { width: "100%", boxSizing: "border-box", border: `1px solid ${C.border}`, borderRadius: 8, padding: "7px 9px", fontSize: 13, fontFamily: "inherit", resize: "vertical", outline: "none", background: C.bg, color: C.text, marginTop: 2 },
    modalWrap: { position: "absolute", inset: 0, background: "rgba(0,0,0,0.25)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 900, padding: 16 },
    modalCard: { background: "#fff", borderRadius: 14, width: 360, maxWidth: "100%", maxHeight: "80%", display: "flex", flexDirection: "column", boxShadow: "0 10px 30px rgba(0,0,0,0.25)" },
    modalHead: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", borderBottom: `1px solid ${C.border}`, fontSize: 15 },
    modalBody: { flex: 1, overflowY: "auto", padding: 8 },
    modalRow: { display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", border: "none", borderBottom: `1px solid ${C.border}`, background: "#fff", padding: "12px 12px", cursor: "pointer", fontSize: 14, color: C.text, textAlign: "left" },
    modalFoot: { padding: 12, borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "flex-end" },
    listFilters: { display: "flex", gap: 8, marginBottom: 16, alignItems: "center", flexWrap: "wrap" },
    filterBtn: { border: `1px solid ${C.border}`, background: C.card, padding: "6px 14px", borderRadius: 20, cursor: "pointer", fontSize: 13, color: C.sub },
    filterActive: { background: C.text, color: "#fff", borderColor: C.text },
    select: { border: `1px solid ${C.border}`, borderRadius: 8, padding: "7px 10px", fontSize: 13, background: C.card, color: C.text, fontFamily: "inherit" },
    section: { marginBottom: 24 },
    sectionHead: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10 },
    dot: { width: 10, height: 10, borderRadius: "50%" },
    sectionTitle: { margin: 0, fontSize: 15, fontWeight: 600 },
    countPill: { background: C.bg, borderRadius: 12, padding: "1px 10px", fontSize: 12, color: C.sub },
    sectionEmpty: { fontSize: 13, color: C.sub, margin: "4px 0" },
    cards: { display: "flex", flexDirection: "row", gap: 12, alignItems: "stretch", overflowX: "auto", overflowY: "hidden", paddingBottom: 8, scrollSnapType: "x proximity", WebkitOverflowScrolling: "touch" },
    cardWrap: { position: "relative", flex: "0 0 auto", width: 220, scrollSnapAlign: "start" },
    cardStar: { position: "absolute", top: 8, right: 8, zIndex: 2, border: "none", background: "rgba(255,255,255,0.9)", borderRadius: "50%", width: 28, height: 28, cursor: "pointer", fontSize: 15, color: C.sub, boxShadow: "0 1px 4px rgba(0,0,0,0.12)" },
    cardStarOn: { color: "#E0A21C" },
    favBtn: { border: "none", background: "transparent", cursor: "pointer", fontSize: 19, color: C.sub, padding: "0 4px" },
    favBtnOn: { color: "#E0A21C" },
    headIconBtn: { border: "none", background: "transparent", cursor: "pointer", color: C.sub, padding: "0 2px", display: "flex", alignItems: "center" },
    headIconBtnOff: { color: "#C0392B" },
    manageLink: { border: "none", background: "transparent", color: C.shape, cursor: "pointer", fontSize: 12, fontWeight: 600, marginLeft: 6, padding: 0 },
    catIconBtn: { border: `1px solid ${C.border}`, background: C.bg, borderRadius: 8, width: 34, height: 34, fontSize: 17, cursor: "pointer", padding: 0, marginRight: 8 },
    iconGrid: { display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 4, padding: "4px 12px 12px" },
    iconChoice: { border: `1px solid transparent`, background: C.bg, borderRadius: 6, fontSize: 17, cursor: "pointer", padding: "5px 0" },
    iconChoiceOn: { borderColor: C.shape, background: "rgba(83,74,183,0.12)" },
    card: { textAlign: "left", border: `1px solid ${C.border}`, background: C.card, borderRadius: 12, padding: 0, cursor: "pointer", display: "flex", flexDirection: "column", overflow: "hidden" },
    cardImgStrip: { display: "flex", overflowX: "auto", scrollSnapType: "x mandatory", gap: 0, width: "100%" },
    cardImg: { width: "100%", flex: "0 0 100%", height: 150, objectFit: "cover", scrollSnapAlign: "start", display: "block" },
    cardImgPlaceholder: { width: "100%", height: 150, display: "flex", alignItems: "center", justifyContent: "center", background: C.bg, borderBottom: `1px solid ${C.border}` },
    placeholderMark: { fontSize: 34, color: C.border },
    cardBody: { padding: 14, display: "flex", flexDirection: "column", gap: 6 },
    cardMeta: { fontSize: 12.5, color: C.sub, textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600 },
    cardTop: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 },
    cardKind: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: C.sub, background: C.bg, padding: "2px 8px", borderRadius: 6 },
    cardTitle: { fontSize: 15, fontWeight: 600 },
    cardDate: { fontSize: 12, color: C.sub },
    chipRow: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" },
    chip: { fontSize: 11, padding: "2px 8px", borderRadius: 20, background: C.bg, color: C.sub, border: `1px solid ${C.border}` },
    cardNote: { fontSize: 13, color: C.sub, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" },
    cardFoot: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 },
    mediaCount: { fontSize: 12, color: C.sub },
    locate: { fontSize: 12.5, color: C.visited, fontWeight: 600, marginLeft: "auto" },
    empty: { color: C.sub, fontSize: 14 },
    nearbyPrompt: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, textAlign: "center" },

    editor: { position: "absolute", top: 0, right: 0, height: "100%", width: 340, maxWidth: "90%", background: C.card, borderLeft: `1px solid ${C.border}`, boxShadow: "-4px 0 16px rgba(0,0,0,0.08)", display: "flex", flexDirection: "column", zIndex: 950 },
    editorHead: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: `1px solid ${C.border}` },
    editorKind: { fontSize: 15 },
    iconBtn: { border: "none", background: "transparent", fontSize: 16, cursor: "pointer", color: C.sub },
    editorBody: { flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 6 },

    readTitle: { fontSize: 19, fontWeight: 700, marginBottom: 4 },
    readDesc: { fontSize: 14, color: C.text, lineHeight: 1.4, marginBottom: 4 },
    readRow: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14, marginTop: 10 },
    readLabel: { fontSize: 12.5, fontWeight: 600, color: C.sub, marginTop: 14 },
    readNote: { fontSize: 14, lineHeight: 1.5, marginTop: 4, whiteSpace: "pre-wrap" },
    readHint: { fontSize: 12.5, color: C.sub, marginTop: 14, fontStyle: "italic" },
    thumbRow: { display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" },
    thumb: { width: 44, height: 44, borderRadius: 6, objectFit: "cover", border: `1px solid ${C.border}` },
    miniMap: { width: "100%", height: 140, borderRadius: 10, border: `1px solid ${C.border}`, marginTop: 4, overflow: "hidden" },
    miniMapBtn: { marginTop: 6, border: `1px solid ${C.border}`, background: C.card, color: C.text, padding: "8px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, width: "100%" },
    googleBtn: { display: "block", textAlign: "center", marginTop: 4, border: "none", background: "#185FA5", color: "#fff", padding: "10px", borderRadius: 8, cursor: "pointer", fontSize: 13.5, fontWeight: 600, textDecoration: "none" },
    googleDetails: { marginTop: 8, border: `1px solid ${C.border}`, borderRadius: 10, padding: 10, background: C.bg },
    googleMsg: { fontSize: 12.5, color: C.sub, lineHeight: 1.5 },
    googleRating: { fontSize: 14, fontWeight: 700, color: "#E0A21C", marginBottom: 6 },
    review: { fontSize: 13, marginTop: 8, borderTop: `1px solid ${C.border}`, paddingTop: 8 },
    reviewText: { color: C.sub, marginTop: 2 },
    visToggle: { marginTop: 6, border: `1px solid ${C.visited}`, background: "#fff", color: C.visited, padding: "9px 11px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, textAlign: "left" },
    visHidden: { borderColor: C.sub, color: C.sub },
    eyeToggle: { marginTop: 6, alignSelf: "flex-start", border: `1px solid ${C.border}`, background: "#fff", color: C.visited, width: 42, height: 42, borderRadius: 10, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" },
    eyeToggleOff: { color: C.sub },

    label: { fontSize: 12.5, fontWeight: 600, color: C.sub, marginTop: 8 },
    row: { display: "flex", gap: 10 },
    col: { flex: 1, display: "flex", flexDirection: "column" },
    input: { border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 11px", fontSize: 14, fontFamily: "inherit", outline: "none", background: C.card, color: C.text, width: "100%", boxSizing: "border-box" },
    inputError: { borderColor: C.wishlist },
    autoTag: { fontSize: 10, fontWeight: 600, color: C.shape, background: "rgba(83,74,183,0.12)", padding: "1px 6px", borderRadius: 4, marginLeft: 6, textTransform: "uppercase", letterSpacing: 0.4 },
    cityRead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 11px", fontSize: 14, background: C.bg, color: C.text },
    cityEdit: { border: "none", background: "transparent", color: C.shape, cursor: "pointer", fontSize: 13, fontWeight: 600, padding: 0 },
    errText: { fontSize: 12, color: C.wishlist },
    textarea: { border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 11px", fontSize: 14, fontFamily: "inherit", resize: "vertical", outline: "none", background: C.card, color: C.text },
    segment: { display: "flex", gap: 6 },
    segBtn: { flex: 1, border: `1px solid ${C.border}`, background: C.card, padding: "8px 6px", borderRadius: 8, cursor: "pointer", fontSize: 13, color: C.text },
    addMediaBtn: { border: `1px dashed ${C.border}`, background: C.bg, padding: "10px", borderRadius: 8, cursor: "pointer", fontSize: 13, color: C.text },
    mediaGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginTop: 6 },
    mediaCell: { position: "relative", aspectRatio: "1", borderRadius: 8, overflow: "hidden", background: C.bg },
    mediaThumb: { width: "100%", height: "100%", objectFit: "cover" },
    mediaDel: { position: "absolute", top: 3, right: 3, width: 20, height: 20, borderRadius: "50%", border: "none", background: "rgba(0,0,0,0.6)", color: "#fff", cursor: "pointer", fontSize: 11, lineHeight: "20px", padding: 0 },
    editorFoot: { display: "flex", gap: 8, padding: 14, borderTop: `1px solid ${C.border}` },
    locateBtn: { flex: 1, border: `1px solid ${C.border}`, background: C.card, color: C.text, padding: "10px", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 600 },
    editBtn: { flex: 1, border: "none", background: C.visited, color: "#fff", padding: "10px", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 600 },
    saveBtn: { flex: 1, border: "none", background: C.visited, color: "#fff", padding: "10px", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 600 },
    saveDisabled: { background: C.border, color: "#fff", cursor: "not-allowed" },
    deleteBtn: { border: `1px solid ${C.border}`, background: C.card, color: C.wishlist, padding: "10px 14px", borderRadius: 8, cursor: "pointer", fontSize: 14 },
  };
}
