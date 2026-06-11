import React, { useState, useEffect, useRef } from "react";
import { supabase } from "./supabaseClient";
import Auth from "./Auth.jsx";

// ---------- Theme ----------
const C = {
  paper: "#FBF6EC", card: "#FFFFFF", ink: "#2B2118", maroon: "#7A1F1F",
  maroonDark: "#5E1717", toor: "#E3A82B", toorSoft: "#FBEED0", green: "#1F7A4D",
  wa: "#25D366", line: "#E8DFCE", grey: "#8A7F6F", red: "#B3261E",
};

const READY_OPTIONS = ["Container", "Warehouse", "Next Week"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const FORWARD_PLACES = ["Pure Container", "Warehouse"];
const FORWARD_SIDES = ["Seller Option", "Buyer Option"];
const CUSTOM_DESC = "Custom — write your own";

const deliveryText = (t) => {
  if (t.tradeMode === "Ready") return `Ready Delivery · ${t.readyOption || "—"}`;
  if (t.tradeMode === "Forward")
    return `${t.forwardMonth || "—"} Delivery · ${t.forwardPlace || "—"} · ${t.forwardSide || "—"}`;
  if (t.tradeMode === "Custom") return t.customDescription || "—";
  // older trades saved before this update
  return t.deliveryType === CUSTOM_DESC ? (t.customDescription || "—") : (t.deliveryType || "—");
};

const DEFAULT_PRODUCTS = [
  { name: "Toor", qualities: ["Lemon", "Lincky", "Segain", "Red", "White", "Arusha", "Ghagri", "Mozambique White"] },
  { name: "Urid", qualities: ["FAQ", "SQ", "Brazil"] },
  { name: "Chana", qualities: ["Desi", "Kabuli"] },
  { name: "Moong", qualities: ["Bold", "Medium"] },
  { name: "Cow Peas", qualities: ["White", "Red"] },
];

const emptyTrade = (nextNo, defaultBrokerage) => ({
  tradeNo: String(nextNo),
  date: new Date().toISOString().slice(0, 10),
  product: "",
  quality: "",
  qtyMT: "25",
  buyerId: "",
  sellerId: "",
  buyerPrice: "",
  sellerPrice: "",
  buyerBrokerage: String(defaultBrokerage),
  sellerBrokerage: String(defaultBrokerage),
  tradeMode: "Ready",
  readyOption: "Container",
  forwardMonth: "",
  forwardPlace: "",
  forwardSide: "",
  customDescription: "",
  deliveryFrom: "",
  paymentCondition: "",
  notes: "",
});

// ---------- Helpers ----------
const fmt = (n) =>
  isNaN(n) ? "—" : Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const rupee = (n) => (isNaN(n) ? "—" : "₹" + fmt(n));
const bagsFromMT = (mt) => Math.round(Number(mt) * 20);
const fclFromMT = (mt) => Number(mt) / 25;

const waLink = (phone, text) => {
  let p = (phone || "").replace(/\D/g, "");
  if (p.length === 10) p = "91" + p;
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
};

function calcTrade(t, contacts) {
  const mt = Number(t.qtyMT) || 0;
  const bags = bagsFromMT(mt);
  const units100 = mt * 10;
  const buyer = contacts.find((c) => c.id === t.buyerId);
  const seller = contacts.find((c) => c.id === t.sellerId);
  const buyerIsBroker = buyer?.type === "Broker";
  const sellerIsBroker = seller?.type === "Broker";
  const buyerBrokerage = buyerIsBroker ? 0 : (Number(t.buyerBrokerage) || 0) * bags;
  const sellerBrokerage = sellerIsBroker ? 0 : (Number(t.sellerBrokerage) || 0) * bags;
  const bp = Number(t.buyerPrice) || 0;
  const sp = Number(t.sellerPrice) || 0;
  const margin = bp && sp ? (bp - sp) * units100 : 0;
  return {
    mt, bags, units100, buyer, seller, buyerIsBroker, sellerIsBroker,
    buyerBrokerage, sellerBrokerage, margin,
    total: buyerBrokerage + sellerBrokerage + margin,
  };
}

function computePositions(trades, contacts) {
  // contactId -> { contact, products: { key: {bought, sold, buyVal, sellVal} } }
  const map = {};
  const ensure = (id, key) => {
    if (!map[id]) map[id] = { contact: contacts.find((c) => c.id === id), products: {} };
    if (!map[id].products[key]) map[id].products[key] = { bought: 0, sold: 0, buyVal: 0, sellVal: 0 };
    return map[id].products[key];
  };
  trades.forEach((t) => {
    const mt = Number(t.qtyMT) || 0;
    if (!mt) return;
    const key = t.product + (t.quality ? " – " + t.quality : "");
    const bp = Number(t.buyerPrice) || 0;
    const sp = Number(t.sellerPrice) || 0;
    if (t.buyerId) {
      const r = ensure(t.buyerId, key);
      r.bought += mt;
      r.buyVal += mt * 10 * bp; // rate is per 100 kg → MT × 10 units of 100kg
    }
    if (t.sellerId) {
      const r = ensure(t.sellerId, key);
      r.sold += mt;
      r.sellVal += mt * 10 * sp;
    }
  });
  return Object.values(map)
    .filter((e) => e.contact)
    .map((e) => {
      let totalPL = 0;
      const rows = Object.entries(e.products).map(([key, r]) => {
        const avgBuy = r.bought ? r.buyVal / (r.bought * 10) : 0;
        const avgSell = r.sold ? r.sellVal / (r.sold * 10) : 0;
        const net = r.bought - r.sold;
        const matched = Math.min(r.bought, r.sold);
        const pl = matched > 0 ? matched * 10 * (avgSell - avgBuy) : 0;
        totalPL += pl;
        return { key, ...r, avgBuy, avgSell, net, matched, pl };
      });
      return { contact: e.contact, rows, totalPL };
    })
    .sort((a, b) => a.contact.name.localeCompare(b.contact.name));
}

function buyerMessage(t, calc, brokerName) {
  return [
    `*TRADE CONFIRMATION*`,
    `Trade No: ${t.tradeNo}`,
    `Date: ${t.date}`,
    ``,
    `*✅ Sold to you:*`,
    `*${t.product}${t.quality ? " – " + t.quality : ""}*`,
    `Quantity: ${t.qtyMT} MT (${calc.bags} bags)${calc.mt % 25 === 0 ? ` / ${fclFromMT(calc.mt)} FCL` : ""}`,
    `Rate: ₹${t.buyerPrice} per 100 kg`,
    `Delivery: ${deliveryText(t)}`,
    t.deliveryFrom ? `Delivery from: ${t.deliveryFrom}` : null,
    t.paymentCondition ? `Payment: ${t.paymentCondition}` : null,
    calc.buyerBrokerage > 0
      ? `Brokerage: ₹${t.buyerBrokerage} per bag`
      : `Brokerage: Nil (broker-to-broker)`,
    ``,
    `Broker: ${brokerName || "—"}`,
    `Please confirm.`,
  ].filter((x) => x !== null).join("\n");
}

function sellerMessage(t, calc, brokerName) {
  return [
    `*TRADE CONFIRMATION*`,
    `Trade No: ${t.tradeNo}`,
    `Date: ${t.date}`,
    ``,
    `*✅ Bought from you:*`,
    `*${t.product}${t.quality ? " – " + t.quality : ""}*`,
    `Quantity: ${t.qtyMT} MT (${calc.bags} bags)${calc.mt % 25 === 0 ? ` / ${fclFromMT(calc.mt)} FCL` : ""}`,
    `Rate: ₹${t.sellerPrice} per 100 kg`,
    `Delivery: ${deliveryText(t)}`,
    t.deliveryFrom ? `Delivery from: ${t.deliveryFrom}` : null,
    t.paymentCondition ? `Payment: ${t.paymentCondition}` : null,
    calc.sellerBrokerage > 0
      ? `Brokerage: ₹${t.sellerBrokerage} per bag`
      : `Brokerage: Nil (broker-to-broker)`,
    ``,
    `Broker: ${brokerName || "—"}`,
    `Please confirm.`,
  ].filter((x) => x !== null).join("\n");
}

// ---------- Small UI pieces ----------
const Label = ({ children }) => (
  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: C.grey, marginBottom: 4 }}>
    {children}
  </div>
);

const inputStyle = {
  width: "100%", boxSizing: "border-box", padding: "10px 12px",
  border: `1.5px solid ${C.line}`, borderRadius: 8, fontSize: 15,
  background: "#fff", color: C.ink, outline: "none",
};

const Field = ({ label, children }) => (
  <div style={{ marginBottom: 12 }}>
    <Label>{label}</Label>
    {children}
  </div>
);

const Btn = ({ onClick, children, color = C.maroon, full, small, outline, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    style={{
      background: outline ? "transparent" : color,
      color: outline ? color : "#fff",
      border: outline ? `1.5px solid ${color}` : "none",
      borderRadius: 8,
      padding: small ? "7px 12px" : "12px 16px",
      fontSize: small ? 13 : 15,
      fontWeight: 700,
      width: full ? "100%" : "auto",
      cursor: "pointer",
      opacity: disabled ? 0.6 : 1,
    }}
  >
    {children}
  </button>
);

const Row = ({ label, value, warn }) => (
  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, marginBottom: 4 }}>
    <span style={{ opacity: 0.85 }}>{label}</span>
    <span style={{ fontWeight: 700, color: warn ? "#FF8A80" : "#fff" }}>{value}</span>
  </div>
);

const Empty = ({ text }) => (
  <div style={{ textAlign: "center", color: C.grey, padding: "40px 20px", fontSize: 14, lineHeight: 1.6 }}>{text}</div>
);

// ---------- Main App ----------
export default function App() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!authReady)
    return <div style={{ fontFamily: "system-ui", padding: 40, textAlign: "center", color: C.grey }}>Loading…</div>;
  if (!session) return <Auth />;
  return <BrokerDesk session={session} />;
}

function BrokerDesk({ session }) {
  const userId = session.user.id;
  const [tab, setTab] = useState("new");
  const [loading, setLoading] = useState(true);
  const [contacts, setContacts] = useState([]);
  const [products, setProducts] = useState(DEFAULT_PRODUCTS);
  const [trades, setTrades] = useState([]);
  const [settings, setSettings] = useState({ brokerName: "", defaultBrokerage: 5 });
  const [nextNo, setNextNo] = useState(1);
  const [trade, setTrade] = useState(emptyTrade(1, 5));
  const [savedTrade, setSavedTrade] = useState(null);
  const [editingTradeId, setEditingTradeId] = useState(null);
  const [toast, setToast] = useState("");
  const [syncState, setSyncState] = useState("ok"); // ok | saving | error
  const saveTimer = useRef(null);

  // ----- Load from Supabase -----
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("broker_data")
        .select("data")
        .eq("user_id", userId)
        .maybeSingle();
      if (!error && data?.data) {
        const d = data.data;
        setContacts(d.contacts || []);
        setProducts(d.products?.length ? d.products : DEFAULT_PRODUCTS);
        setTrades(d.trades || []);
        setSettings(d.settings || { brokerName: "", defaultBrokerage: 5 });
        setNextNo(d.nextNo || 1);
        setTrade(emptyTrade(d.nextNo || 1, d.settings?.defaultBrokerage ?? 5));
      }
      setLoading(false);
    })();
  }, [userId]);

  // ----- Save to Supabase (debounced) -----
  const persist = (over = {}) => {
    const payload = {
      contacts: over.contacts ?? contacts,
      products: over.products ?? products,
      trades: over.trades ?? trades,
      settings: over.settings ?? settings,
      nextNo: over.nextNo ?? nextNo,
    };
    setSyncState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const { error } = await supabase
        .from("broker_data")
        .upsert({ user_id: userId, data: payload, updated_at: new Date().toISOString() });
      setSyncState(error ? "error" : "ok");
      if (error) showToast("Sync failed — check internet");
    }, 600);
  };

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  };

  // ----- Trade actions -----
  const calc = calcTrade(trade, contacts);
  const selProduct = products.find((p) => p.name === trade.product);

  const saveTrade = () => {
    if (!trade.product) return showToast("Select a product");
    if (!trade.buyerId || !trade.sellerId) return showToast("Select buyer and seller");
    if (!trade.buyerPrice || !trade.sellerPrice) return showToast("Enter both prices");
    if (Number(trade.qtyMT) < 25) return showToast("Minimum quantity is 25 MT (1 FCL)");
    if (trade.tradeMode === "Forward" && (!trade.forwardMonth || !trade.forwardPlace || !trade.forwardSide))
      return showToast("Select month, place and option for forward trade");
    if (trade.tradeMode === "Custom" && !trade.customDescription.trim())
      return showToast("Write your trade description");
    let newTrades, savedT;
    if (editingTradeId) {
      savedT = { ...trade, id: editingTradeId };
      newTrades = trades.map((t) => (t.id === editingTradeId ? savedT : t));
      setTrades(newTrades);
      persist({ trades: newTrades });
      setEditingTradeId(null);
      showToast("Trade updated ✓");
    } else {
      savedT = { ...trade, id: Date.now() };
      newTrades = [savedT, ...trades];
      const newNext = Math.max(nextNo, Number(trade.tradeNo) || 0) + 1;
      setTrades(newTrades);
      setNextNo(newNext);
      persist({ trades: newTrades, nextNo: newNext });
      showToast("Trade saved ✓");
    }
    setSavedTrade(savedT);
  };

  const startEditTrade = (t) => {
    setTrade({ ...t });
    setEditingTradeId(t.id);
    setTab("new");
  };
  const cancelEditTrade = () => {
    setEditingTradeId(null);
    setTrade(emptyTrade(nextNo, settings.defaultBrokerage));
  };

  const deleteTrade = (id) => {
    const newTrades = trades.filter((t) => t.id !== id);
    setTrades(newTrades);
    persist({ trades: newTrades });
  };

  // ----- Contact form -----
  const [cForm, setCForm] = useState({ name: "", phone: "", type: "Party" });
  const [editingId, setEditingId] = useState(null);
  const addContact = () => {
    if (!cForm.name.trim()) return showToast("Enter a name");
    let nc;
    if (editingId) {
      nc = contacts.map((c) => (c.id === editingId ? { ...c, name: cForm.name, phone: cForm.phone, type: cForm.type } : c));
    } else {
      nc = [...contacts, { ...cForm, id: Date.now() }];
    }
    setContacts(nc);
    persist({ contacts: nc });
    setCForm({ name: "", phone: "", type: "Party" });
    setEditingId(null);
    showToast(editingId ? "Updated ✓" : "Saved ✓");
  };
  const startEditContact = (c) => {
    setCForm({ name: c.name, phone: c.phone || "", type: c.type });
    setEditingId(c.id);
  };
  const cancelEditContact = () => {
    setCForm({ name: "", phone: "", type: "Party" });
    setEditingId(null);
  };
  const deleteContact = (id) => {
    const nc = contacts.filter((c) => c.id !== id);
    setContacts(nc);
    persist({ contacts: nc });
  };

  // ----- Product form -----
  const [pForm, setPForm] = useState({ name: "", qualities: "" });
  const addProduct = () => {
    if (!pForm.name.trim()) return showToast("Enter product name");
    const np = [...products, { name: pForm.name.trim(), qualities: pForm.qualities.split(",").map((q) => q.trim()).filter(Boolean) }];
    setProducts(np);
    persist({ products: np });
    setPForm({ name: "", qualities: "" });
    showToast("Saved ✓");
  };
  const addQuality = (pname, q) => {
    if (!q.trim()) return;
    const np = products.map((p) => p.name === pname ? { ...p, qualities: [...p.qualities, q.trim()] } : p);
    setProducts(np);
    persist({ products: np });
  };
  const deleteProduct = (name) => {
    const np = products.filter((p) => p.name !== name);
    setProducts(np);
    persist({ products: np });
  };

  if (loading)
    return <div style={{ fontFamily: "system-ui", padding: 40, textAlign: "center", color: C.grey }}>Loading your ledger…</div>;

  // ---------- WhatsApp confirmation screen ----------
  if (savedTrade) {
    const sc = calcTrade(savedTrade, contacts);
    const bMsg = buyerMessage(savedTrade, sc, settings.brokerName);
    const sMsg = sellerMessage(savedTrade, sc, settings.brokerName);
    return (
      <div style={{ fontFamily: "system-ui", background: C.paper, minHeight: "100vh", padding: 16 }}>
        <div style={{ maxWidth: 520, margin: "0 auto" }}>
          <div style={{ background: C.green, color: "#fff", borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 13, opacity: 0.9 }}>Trade #{savedTrade.tradeNo} saved</div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{savedTrade.product}{savedTrade.quality ? ` – ${savedTrade.quality}` : ""} · {savedTrade.qtyMT} MT</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>Your earning on this trade: <b>{rupee(sc.total)}</b></div>
          </div>

          {[
            { who: "Buyer", c: sc.buyer, msg: bMsg },
            { who: "Seller", c: sc.seller, msg: sMsg },
          ].map(({ who, c, msg }) => (
            <div key={who} style={{ background: "#fff", border: `1.5px solid ${C.line}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
              <div style={{ fontWeight: 800, marginBottom: 2 }}>{who}: {c?.name || "—"} {c?.type === "Broker" && <span style={{ fontSize: 11, background: C.toorSoft, color: C.ink, padding: "2px 6px", borderRadius: 6, marginLeft: 4 }}>BROKER</span>}</div>
              <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13.5, background: "#F2FBF5", border: `1px solid #D7EEDF`, borderRadius: 8, padding: 10, color: C.ink }}>{msg}</pre>
              <a href={waLink(c?.phone, msg)} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                <Btn color={C.wa} full>📱 Send on WhatsApp to {who}</Btn>
              </a>
            </div>
          ))}

          <Btn full outline onClick={() => { setSavedTrade(null); setTrade(emptyTrade(nextNo, settings.defaultBrokerage)); setTab("new"); }}>
            ✓ Done — New Trade
          </Btn>
        </div>
      </div>
    );
  }

  // ---------- Tabs ----------
  const tabs = [
    { id: "new", label: "New", icon: "✍️" },
    { id: "trades", label: "Trades", icon: "📒" },
    { id: "position", label: "P&L", icon: "📊" },
    { id: "parties", label: "Parties", icon: "👥" },
    { id: "products", label: "Products", icon: "🌾" },
    { id: "settings", label: "Setup", icon: "⚙️" },
  ];

  const totalEarnings = trades.reduce((s, t) => s + calcTrade(t, contacts).total, 0);

  return (
    <div style={{ fontFamily: "system-ui", background: C.paper, minHeight: "100vh", paddingBottom: 80 }}>
      {/* Header */}
      <div style={{ background: C.maroon, color: "#fff", padding: "14px 16px 12px", borderBottom: `4px solid ${C.toor}` }}>
        <div style={{ maxWidth: 520, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div>
            <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: 0.3 }}>Dalal Bahi <span style={{ color: C.toor }}>·</span> Pulses Desk</div>
            <div style={{ fontSize: 11.5, opacity: 0.85 }}>
              {settings.brokerName || "Set your broker name in Setup"}
              {" · "}
              <span style={{ color: syncState === "error" ? "#FFB4A9" : "#C9E7D4" }}>
                {syncState === "saving" ? "Syncing…" : syncState === "error" ? "Sync failed" : "Synced ✓"}
              </span>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, opacity: 0.8, textTransform: "uppercase", letterSpacing: 1 }}>Total earned</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.toor }}>{rupee(totalEarnings)}</div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 520, margin: "0 auto", padding: 16 }}>
        {/* ============ NEW TRADE ============ */}
        {tab === "new" && (
          <div>
            {editingTradeId && (
              <div style={{ background: C.toorSoft, border: `1.5px solid ${C.toor}`, borderRadius: 10, padding: "10px 12px", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 800, fontSize: 14 }}>✏️ Editing trade #{trade.tradeNo}</span>
                <Btn small outline onClick={cancelEditTrade}>Cancel edit</Btn>
              </div>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}><Field label="Trade No."><input style={inputStyle} value={trade.tradeNo} onChange={(e) => setTrade({ ...trade, tradeNo: e.target.value })} /></Field></div>
              <div style={{ flex: 1.4 }}><Field label="Date"><input type="date" style={inputStyle} value={trade.date} onChange={(e) => setTrade({ ...trade, date: e.target.value })} /></Field></div>
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <Field label="Product">
                  <select style={inputStyle} value={trade.product} onChange={(e) => setTrade({ ...trade, product: e.target.value, quality: "" })}>
                    <option value="">Select…</option>
                    {products.map((p) => <option key={p.name}>{p.name}</option>)}
                  </select>
                </Field>
              </div>
              <div style={{ flex: 1 }}>
                <Field label="Quality">
                  <select style={inputStyle} value={trade.quality} onChange={(e) => setTrade({ ...trade, quality: e.target.value })} disabled={!selProduct}>
                    <option value="">Select…</option>
                    {selProduct?.qualities.map((q) => <option key={q}>{q}</option>)}
                  </select>
                </Field>
              </div>
            </div>

            <Field label="Quantity (MT) — min 25 MT = 1 FCL = 500 bags">
              <input type="number" style={inputStyle} value={trade.qtyMT} onChange={(e) => setTrade({ ...trade, qtyMT: e.target.value })} />
              <div style={{ fontSize: 12.5, color: Number(trade.qtyMT) < 25 ? C.red : C.green, marginTop: 4, fontWeight: 600 }}>
                {Number(trade.qtyMT) < 25
                  ? "⚠ Below 25 MT minimum"
                  : `= ${fmt(calc.bags)} bags (50 kg)${calc.mt % 25 === 0 ? ` · ${fclFromMT(calc.mt)} FCL` : ""}`}
              </div>
            </Field>

            {/* Seller block */}
            <div style={{ background: "#fff", border: `1.5px solid ${C.line}`, borderLeft: `4px solid ${C.toor}`, borderRadius: 10, padding: 12, marginBottom: 12 }}>
              <div style={{ fontWeight: 800, marginBottom: 8 }}>Seller side <span style={{ fontSize: 11, color: C.grey }}>(you buy from)</span></div>
              <Field label="Seller">
                <PartyPicker contacts={contacts} value={trade.sellerId} onChange={(id) => setTrade({ ...trade, sellerId: id })} placeholder="Type 2-3 letters to search seller…" />
              </Field>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}><Field label="Seller rate ₹/100kg"><input type="number" style={inputStyle} value={trade.sellerPrice} onChange={(e) => setTrade({ ...trade, sellerPrice: e.target.value })} placeholder="7500" /></Field></div>
                <div style={{ flex: 1 }}>
                  <Field label="Brokerage ₹/bag">
                    {calc.sellerIsBroker
                      ? <div style={{ ...inputStyle, background: C.toorSoft, fontWeight: 700, fontSize: 13 }}>Nil — broker side</div>
                      : <input type="number" style={inputStyle} value={trade.sellerBrokerage} onChange={(e) => setTrade({ ...trade, sellerBrokerage: e.target.value })} />}
                  </Field>
                </div>
              </div>
            </div>

            {/* Buyer block */}
            <div style={{ background: "#fff", border: `1.5px solid ${C.line}`, borderLeft: `4px solid ${C.green}`, borderRadius: 10, padding: 12, marginBottom: 12 }}>
              <div style={{ fontWeight: 800, marginBottom: 8 }}>Buyer side <span style={{ fontSize: 11, color: C.grey }}>(you sell to)</span></div>
              <Field label="Buyer">
                <PartyPicker contacts={contacts} value={trade.buyerId} onChange={(id) => setTrade({ ...trade, buyerId: id })} placeholder="Type 2-3 letters to search buyer…" />
              </Field>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}><Field label="Buyer rate ₹/100kg"><input type="number" style={inputStyle} value={trade.buyerPrice} onChange={(e) => setTrade({ ...trade, buyerPrice: e.target.value })} placeholder="7550" /></Field></div>
                <div style={{ flex: 1 }}>
                  <Field label="Brokerage ₹/bag">
                    {calc.buyerIsBroker
                      ? <div style={{ ...inputStyle, background: C.toorSoft, fontWeight: 700, fontSize: 13 }}>Nil — broker side</div>
                      : <input type="number" style={inputStyle} value={trade.buyerBrokerage} onChange={(e) => setTrade({ ...trade, buyerBrokerage: e.target.value })} />}
                  </Field>
                </div>
              </div>
            </div>

            <Field label="Trade category / Delivery">
              {/* Step 1: Ready or Forward */}
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                {["Ready", "Forward", "Custom"].map((m) => (
                  <button key={m}
                    onClick={() => setTrade({ ...trade, tradeMode: m, readyOption: m === "Ready" ? "Container" : "", forwardMonth: "", forwardPlace: "", forwardSide: "", customDescription: "" })}
                    style={{ flex: 1, padding: 10, borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: 14, border: `1.5px solid ${trade.tradeMode === m ? C.maroon : C.line}`, background: trade.tradeMode === m ? C.maroon : "#fff", color: trade.tradeMode === m ? "#fff" : C.ink }}>
                    {m}
                  </button>
                ))}
              </div>

              {/* Ready: pick place */}
              {trade.tradeMode === "Ready" && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {READY_OPTIONS.map((o) => (
                    <button key={o} onClick={() => setTrade({ ...trade, readyOption: o })}
                      style={{ padding: "8px 14px", borderRadius: 16, fontWeight: 600, cursor: "pointer", fontSize: 13, border: `1.5px solid ${trade.readyOption === o ? C.green : C.line}`, background: trade.readyOption === o ? C.green : "#fff", color: trade.readyOption === o ? "#fff" : C.ink }}>
                      {o}
                    </button>
                  ))}
                </div>
              )}

              {/* Forward: month → place → option */}
              {trade.tradeMode === "Forward" && (
                <div>
                  <select style={{ ...inputStyle, marginBottom: 8 }} value={trade.forwardMonth}
                    onChange={(e) => setTrade({ ...trade, forwardMonth: e.target.value, forwardPlace: "", forwardSide: "" })}>
                    <option value="">Select delivery month…</option>
                    {MONTHS.map((m) => <option key={m}>{m}</option>)}
                  </select>

                  {trade.forwardMonth && (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                      {FORWARD_PLACES.map((p) => (
                        <button key={p} onClick={() => setTrade({ ...trade, forwardPlace: p, forwardSide: "" })}
                          style={{ padding: "8px 14px", borderRadius: 16, fontWeight: 600, cursor: "pointer", fontSize: 13, border: `1.5px solid ${trade.forwardPlace === p ? C.green : C.line}`, background: trade.forwardPlace === p ? C.green : "#fff", color: trade.forwardPlace === p ? "#fff" : C.ink }}>
                          {p}
                        </button>
                      ))}
                    </div>
                  )}

                  {trade.forwardPlace && (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {FORWARD_SIDES.map((s) => (
                        <button key={s} onClick={() => setTrade({ ...trade, forwardSide: s })}
                          style={{ padding: "8px 14px", borderRadius: 16, fontWeight: 600, cursor: "pointer", fontSize: 13, border: `1.5px solid ${trade.forwardSide === s ? C.toor : C.line}`, background: trade.forwardSide === s ? C.toor : "#fff", color: trade.forwardSide === s ? C.ink : C.ink }}>
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Custom: free text */}
              {trade.tradeMode === "Custom" && (
                <input
                  style={inputStyle}
                  value={trade.customDescription}
                  onChange={(e) => setTrade({ ...trade, customDescription: e.target.value })}
                  placeholder="Write your own trade description…"
                />
              )}

              {/* Live preview of how it will appear */}
              <div style={{ fontSize: 12.5, color: C.green, marginTop: 8, fontWeight: 700 }}>
                ✓ {deliveryText(trade)}
              </div>
            </Field>

            <Field label="Delivery from (write any place)">
              <input style={inputStyle} value={trade.deliveryFrom} onChange={(e) => setTrade({ ...trade, deliveryFrom: e.target.value })} placeholder="e.g. Chennai, Mumbai, Mundra Port…" />
            </Field>

            <Field label="Payment condition">
              <input style={inputStyle} value={trade.paymentCondition} onChange={(e) => setTrade({ ...trade, paymentCondition: e.target.value })} placeholder="e.g. Payment within 3 days of delivery" />
            </Field>

            {/* Earnings summary */}
            <div style={{ background: C.ink, color: "#fff", borderRadius: 10, padding: 14, marginBottom: 14 }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, opacity: 0.7, marginBottom: 6 }}>Your earning on this trade</div>
              <Row label={`Seller brokerage ${calc.sellerIsBroker ? "(broker — nil)" : `(${trade.sellerBrokerage} × ${fmt(calc.bags)} bags)`}`} value={rupee(calc.sellerBrokerage)} />
              <Row label={`Buyer brokerage ${calc.buyerIsBroker ? "(broker — nil)" : `(${trade.buyerBrokerage} × ${fmt(calc.bags)} bags)`}`} value={rupee(calc.buyerBrokerage)} />
              <Row label="Price difference margin" value={rupee(calc.margin)} warn={calc.margin < 0} />
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.25)", marginTop: 8, paddingTop: 8, display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: 17 }}>
                <span>Total</span><span style={{ color: C.toor }}>{rupee(calc.total)}</span>
              </div>
            </div>

            <Btn full onClick={saveTrade}>{editingTradeId ? "💾 Update Trade & Prepare WhatsApp" : "💾 Save Trade & Prepare WhatsApp"}</Btn>
          </div>
        )}

        {/* ============ TRADES LIST ============ */}
        {tab === "trades" && (
          <div>
            {trades.length === 0 && <Empty text="No trades yet. Your saved trades will appear here as a ledger." />}
            {trades.map((t) => {
              const tc = calcTrade(t, contacts);
              return (
                <div key={t.id} style={{ background: "#fff", border: `1.5px solid ${C.line}`, borderRadius: 10, padding: 12, marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <div style={{ fontWeight: 800 }}>#{t.tradeNo} · {t.product}{t.quality ? ` – ${t.quality}` : ""}</div>
                    <div style={{ fontSize: 12, color: C.grey }}>{t.date}</div>
                  </div>
                  <div style={{ fontSize: 13.5, marginTop: 4, color: C.ink }}>
                    {tc.seller?.name || "—"} → {tc.buyer?.name || "—"} · {t.qtyMT} MT ({fmt(tc.bags)} bags)
                  </div>
                  <div style={{ fontSize: 13, color: C.grey }}>{deliveryText(t)}{t.deliveryFrom ? ` · From ${t.deliveryFrom}` : ""} · Sell ₹{t.sellerPrice} / Buy ₹{t.buyerPrice} per 100kg</div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                    <div style={{ fontWeight: 800, color: C.green }}>{rupee(tc.total)}</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <Btn small outline onClick={() => startEditTrade(t)}>✏️</Btn>
                      <Btn small color={C.wa} onClick={() => setSavedTrade(t)}>WhatsApp</Btn>
                      <Btn small outline color={C.red} onClick={() => { if (window.confirm("Delete trade #" + t.tradeNo + "?")) deleteTrade(t.id); }}>Delete</Btn>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ============ POSITION / P&L ============ */}
        {tab === "position" && (
          <div>
            {trades.length === 0 && <Empty text="No trades yet. Positions and P&L will appear here once you enter trades." />}
            {computePositions(trades, contacts).map(({ contact, rows, totalPL }) => (
              <div key={contact.id} style={{ background: "#fff", border: `1.5px solid ${C.line}`, borderRadius: 10, padding: 12, marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontWeight: 800 }}>
                    {contact.name}{" "}
                    <span style={{ fontSize: 11, background: contact.type === "Broker" ? C.toorSoft : "#E8F3EC", padding: "2px 6px", borderRadius: 6 }}>{contact.type.toUpperCase()}</span>
                  </div>
                  <div style={{ fontWeight: 800, color: totalPL > 0 ? C.green : totalPL < 0 ? C.red : C.grey, fontSize: 15 }}>
                    {totalPL === 0 ? "P&L —" : (totalPL > 0 ? "+" : "−") + "₹" + fmt(Math.abs(totalPL))}
                  </div>
                </div>
                {rows.map((r) => (
                  <div key={r.key} style={{ borderTop: `1px solid #F2EDE0`, paddingTop: 8, marginTop: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{r.key}</span>
                      <span style={{ fontWeight: 800, fontSize: 13, padding: "3px 10px", borderRadius: 12, background: r.net > 0 ? "#E8F3EC" : r.net < 0 ? "#FBE9E7" : "#F2EDE0", color: r.net > 0 ? C.green : r.net < 0 ? C.red : C.grey }}>
                        {r.net > 0 ? `LONG ${fmt(r.net)} MT` : r.net < 0 ? `SHORT ${fmt(Math.abs(r.net))} MT` : "SQUARED OFF"}
                      </span>
                    </div>
                    <div style={{ fontSize: 12.5, color: C.grey, marginTop: 4, lineHeight: 1.6 }}>
                      Bought {fmt(r.bought)} MT{r.bought ? ` @ avg ₹${fmt(r.avgBuy)}` : ""} · Sold {fmt(r.sold)} MT{r.sold ? ` @ avg ₹${fmt(r.avgSell)}` : ""}
                      {r.matched > 0 && (
                        <span style={{ fontWeight: 700, color: r.pl > 0 ? C.green : r.pl < 0 ? C.red : C.grey }}>
                          {" "}· P&L on {fmt(r.matched)} MT: {(r.pl >= 0 ? "+" : "−") + "₹" + fmt(Math.abs(r.pl))}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
            {trades.length > 0 && (
              <div style={{ fontSize: 12, color: C.grey, lineHeight: 1.6, padding: "4px 4px 0" }}>
                <b>How to read:</b> LONG = party bought more than sold (holding stock). SHORT = sold more than bought (needs to buy/deliver). P&L is calculated on the matched (bought & sold) quantity at average rates. Rates per 100 kg.
              </div>
            )}
          </div>
        )}

        {/* ============ PARTIES ============ */}
        {tab === "parties" && (
          <div>
            <div style={{ background: "#fff", border: `1.5px solid ${editingId ? C.toor : C.line}`, borderRadius: 10, padding: 12, marginBottom: 16 }}>
              <div style={{ fontWeight: 800, marginBottom: 8 }}>{editingId ? "✏️ Edit party / broker" : "Add party / broker"}</div>
              <Field label="Name"><input style={inputStyle} value={cForm.name} onChange={(e) => setCForm({ ...cForm, name: e.target.value })} placeholder="Firm or person name" /></Field>
              <Field label="WhatsApp number"><input style={inputStyle} value={cForm.phone} onChange={(e) => setCForm({ ...cForm, phone: e.target.value })} placeholder="10-digit mobile" /></Field>
              <Field label="Type">
                <div style={{ display: "flex", gap: 8 }}>
                  {["Party", "Broker"].map((ty) => (
                    <button key={ty} onClick={() => setCForm({ ...cForm, type: ty })}
                      style={{ flex: 1, padding: 10, borderRadius: 8, fontWeight: 700, cursor: "pointer", border: `1.5px solid ${cForm.type === ty ? C.maroon : C.line}`, background: cForm.type === ty ? C.maroon : "#fff", color: cForm.type === ty ? "#fff" : C.ink }}>
                      {ty}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: C.grey, marginTop: 4 }}>Brokers pay no brokerage — one-side brokerage applies automatically.</div>
              </Field>
              {editingId ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ flex: 1 }}><Btn full onClick={addContact}>💾 Save changes</Btn></div>
                  <Btn outline onClick={cancelEditContact}>Cancel</Btn>
                </div>
              ) : (
                <Btn full onClick={addContact}>＋ Add</Btn>
              )}
            </div>
            {contacts.length === 0 && <Empty text="No parties yet. Add your buyers, sellers and fellow brokers here." />}
            {contacts.map((c) => (
              <div key={c.id} style={{ background: "#fff", border: `1.5px solid ${C.line}`, borderRadius: 10, padding: 12, marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{c.name} <span style={{ fontSize: 11, background: c.type === "Broker" ? C.toorSoft : "#E8F3EC", padding: "2px 6px", borderRadius: 6, marginLeft: 4 }}>{c.type.toUpperCase()}</span></div>
                  <div style={{ fontSize: 13, color: C.grey }}>{c.phone || "No number"}</div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <Btn small outline onClick={() => startEditContact(c)}>✏️ Edit</Btn>
                  <Btn small outline color={C.red} onClick={() => { if (window.confirm("Delete " + c.name + "?")) deleteContact(c.id); }}>✕</Btn>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ============ PRODUCTS ============ */}
        {tab === "products" && (
          <div>
            <div style={{ background: "#fff", border: `1.5px solid ${C.line}`, borderRadius: 10, padding: 12, marginBottom: 16 }}>
              <div style={{ fontWeight: 800, marginBottom: 8 }}>Add product</div>
              <Field label="Product name"><input style={inputStyle} value={pForm.name} onChange={(e) => setPForm({ ...pForm, name: e.target.value })} placeholder="e.g. Masoor" /></Field>
              <Field label="Qualities (comma separated)"><input style={inputStyle} value={pForm.qualities} onChange={(e) => setPForm({ ...pForm, qualities: e.target.value })} placeholder="e.g. Canada, Australia Bold" /></Field>
              <Btn full onClick={addProduct}>＋ Add Product</Btn>
            </div>
            {products.map((p) => <ProductCard key={p.name} p={p} onAddQuality={addQuality} onDelete={deleteProduct} />)}
          </div>
        )}

        {/* ============ SETTINGS ============ */}
        {tab === "settings" && (
          <div>
            <Field label="Your broker / firm name (appears in WhatsApp confirmation)">
              <input style={inputStyle} value={settings.brokerName} onChange={(e) => setSettings({ ...settings, brokerName: e.target.value })} placeholder="e.g. Sharma Brokers, Mumbai" />
            </Field>
            <Field label="Default brokerage (₹ per bag)">
              <input type="number" style={inputStyle} value={settings.defaultBrokerage} onChange={(e) => setSettings({ ...settings, defaultBrokerage: e.target.value })} />
            </Field>
            <Btn full onClick={() => { persist({ settings }); showToast("Settings saved ✓"); }}>💾 Save Settings</Btn>

            <div style={{ marginTop: 16 }}>
              <Btn full outline color={C.red} onClick={async () => { await supabase.auth.signOut(); }}>Log out ({session.user.email})</Btn>
            </div>

            <div style={{ marginTop: 20, fontSize: 12.5, color: C.grey, lineHeight: 1.6 }}>
              <b>How calculations work:</b><br />
              1 MT = 20 bags of 50 kg · 25 MT = 1 FCL = 500 bags.<br />
              Rates are per 100 kg, so 25 MT = 250 units of 100 kg.<br />
              Margin = (buyer rate − seller rate) × MT × 10.<br />
              Brokerage = ₹/bag × bags, charged only to Parties (not Brokers).
            </div>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", bottom: 90, left: "50%", transform: "translateX(-50%)", background: C.ink, color: "#fff", padding: "10px 18px", borderRadius: 20, fontSize: 14, fontWeight: 600, zIndex: 50 }}>
          {toast}
        </div>
      )}

      {/* Bottom tab bar */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#fff", borderTop: `1.5px solid ${C.line}`, display: "flex", zIndex: 40 }}>
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ flex: 1, padding: "8px 0 10px", border: "none", background: "transparent", cursor: "pointer", color: tab === t.id ? C.maroon : C.grey, fontWeight: tab === t.id ? 800 : 600, fontSize: 11, borderTop: tab === t.id ? `3px solid ${C.maroon}` : "3px solid transparent" }}>
            <div style={{ fontSize: 18 }}>{t.icon}</div>
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function PartyPicker({ contacts, value, onChange, placeholder }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const sel = contacts.find((c) => c.id === value);
  const matches = contacts.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8);

  return (
    <div style={{ position: "relative" }}>
      <input
        style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1.5px solid #E8DFCE", borderRadius: 8, fontSize: 15, background: sel && !open ? "#F2FBF5" : "#fff", color: "#2B2118", outline: "none", fontWeight: sel && !open ? 700 : 400 }}
        value={open ? q : sel ? `${sel.name} (${sel.type})` : ""}
        placeholder={placeholder}
        onFocus={() => { setOpen(true); setQ(""); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => setQ(e.target.value)}
      />
      {sel && !open && (
        <button onMouseDown={(e) => { e.preventDefault(); onChange(""); setQ(""); }}
          style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", border: "none", background: "transparent", color: "#B3261E", fontWeight: 800, cursor: "pointer", fontSize: 15 }}>
          ✕
        </button>
      )}
      {open && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 30, background: "#fff", border: "1.5px solid #E8DFCE", borderRadius: 8, marginTop: 4, maxHeight: 240, overflowY: "auto", boxShadow: "0 6px 16px rgba(0,0,0,0.12)" }}>
          {matches.length === 0 && (
            <div style={{ padding: 12, fontSize: 13.5, color: "#8A7F6F" }}>No match — add this party in the Parties tab first</div>
          )}
          {matches.map((c) => (
            <button key={c.id}
              onMouseDown={(e) => { e.preventDefault(); onChange(c.id); setOpen(false); setQ(""); }}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", textAlign: "left", padding: "10px 12px", border: "none", borderBottom: "1px solid #F2EDE0", background: "transparent", cursor: "pointer", fontSize: 14.5 }}>
              <span style={{ fontWeight: 600, color: "#2B2118" }}>{c.name}</span>
              <span style={{ fontSize: 11, background: c.type === "Broker" ? "#FBEED0" : "#E8F3EC", padding: "2px 8px", borderRadius: 8, fontWeight: 700 }}>{c.type.toUpperCase()}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ProductCard({ p, onAddQuality, onDelete }) {
  const [q, setQ] = useState("");
  return (
    <div style={{ background: "#fff", border: "1.5px solid #E8DFCE", borderRadius: 10, padding: 12, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>{p.name}</div>
        <button onClick={() => { if (window.confirm("Delete " + p.name + "?")) onDelete(p.name); }} style={{ border: "none", background: "transparent", color: "#B3261E", cursor: "pointer", fontWeight: 700 }}>✕</button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {p.qualities.map((qq) => (
          <span key={qq} style={{ fontSize: 12.5, background: "#FBEED0", padding: "4px 10px", borderRadius: 12, fontWeight: 600 }}>{qq}</span>
        ))}
        {p.qualities.length === 0 && <span style={{ fontSize: 12.5, color: "#8A7F6F" }}>No qualities yet</span>}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add quality…" style={{ flex: 1, padding: "8px 10px", border: "1.5px solid #E8DFCE", borderRadius: 8, fontSize: 13.5 }} />
        <button onClick={() => { onAddQuality(p.name, q); setQ(""); }} style={{ background: "#7A1F1F", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontWeight: 700, cursor: "pointer" }}>＋</button>
      </div>
    </div>
  );
}
