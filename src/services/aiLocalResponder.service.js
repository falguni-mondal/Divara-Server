import { Product, CATEGORY_LABELS } from "../models/Product.js";
import { SiteContent } from "../models/SiteContent.js";
import { PolicyPage } from "../models/PolicyPage.js";
import { Bag } from "../models/Bag.js";
import { Coupon } from "../models/Coupon.js";
import { Order } from "../models/Order.js";

const ORDINAL_MAP = {
  first: 1, "1st": 1, "1": 1, one: 1,
  second: 2, "2nd": 2, "2": 2, two: 2,
  third: 3, "3rd": 3, "3": 3, three: 3,
  fourth: 4, "4th": 4, "4": 4, four: 4,
  fifth: 5, "5th": 5, "5": 5, five: 5,
  sixth: 6, "6th": 6, "6": 6, six: 6,
  seventh: 7, "7th": 7, "7": 7, seven: 7,
  eighth: 8, "8th": 8, "8": 8, eight: 8,
  ninth: 9, "9th": 9, "9": 9, nine: 9,
  tenth: 10, "10th": 10, "10": 10, ten: 10,
};

const CATEGORY_MAP = {
  saree: "saree", sarees: "saree", sari: "saree", saris: "saree",
  dress: "dress", dresses: "dress", gown: "dress", gowns: "dress",
  denim: "denim", denims: "denim", jeans: "denim",
  shirt: "shirt", shirts: "shirt",
  sweatshirt: "sweatshirt", sweatshirts: "sweatshirt", hoodie: "sweatshirt",
  kurta: "kurta", kurtas: "kurta", kurti: "kurta",
  lehenga: "lehenga", lehengas: "lehenga", lahenga: "lehenga",
  jacket: "jacket", jackets: "jacket", cape: "jacket",
  trouser: "trouser", trousers: "trouser", pant: "trouser", pants: "trouser",
  knitwear: "knitwear", sweater: "knitwear",
};

const SEASON_MAP = {
  winter: "Winter",
  spring: "Spring",
  summer: "Summer",
  autumn: "Autumn",
};

// Exported strictly for aiTools.service.js (so external LLM color searches never match description noise)
export const COLOR_FAMILIES = {
  pink: ["pink", "rani", "rose", "blush", "magenta", "coral", "fuchsia", "peach", "lotus"],
  yellow: ["yellow", "mustard", "haldi", "marigold", "ochre", "gold", "golden", "amber", "lemon", "sunflower"],
  red: ["red", "crimson", "maroon", "burgundy", "sindoor", "ruby", "scarlet", "wine", "vermilion", "oxblood"],
  blue: ["blue", "navy", "indigo", "cobalt", "teal", "peacock", "midnight", "sky", "royal", "slate", "azure"],
  green: ["green", "emerald", "olive", "sage", "mint", "forest", "pista", "jade", "mehndi", "bottle"],
  white: ["white", "ivory", "cream", "off-white", "pearl", "ecru", "alabaster", "snow", "chalk"],
  black: ["black", "obsidian", "onyx", "jet", "charcoal", "ebony", "noir"],
  beige: ["beige", "sand", "taupe", "champagne", "camel", "nude", "khaki", "tan", "oat"],
  purple: ["purple", "lavender", "lilac", "plum", "violet", "mauve", "aubergine", "jamuni", "berry"],
  orange: ["orange", "rust", "terracotta", "saffron", "tangerine", "apricot", "burnt", "copper"],
  grey: ["grey", "gray", "silver", "ash", "smoke", "pewter", "stone"],
  brown: ["brown", "chocolate", "espresso", "mocha", "walnut", "bronze", "cocoa"],
};

const VOCAB = [
  "collections", "collection", "craftsmanship", "contact", "account", "profile",
  "checkout", "search", "scroll", "slowly", "bottom", "forward", "previous",
  "google", "cookie", "preferences", "shipping", "returns", "privacy", "terms",
  "wishlist", "winter", "spring", "summer", "autumn",
  ...Object.keys(CATEGORY_MAP),
];

// Any negation, festival/occasion, suggestion, styling, color/fabric nuance, or memory escalates to external LLM
const EXTERNAL_ONLY_PATTERN =
  /\b(not|no|dont|don't|except|without|avoid|instead|other than|exclude|suggest|recommend|best|better|compare|difference|match|matching|goes with|pair with|why|should i|festival|festive|diwali|puja|holi|eid|navratri|wedding|sangeet|mehendi|reception|party|occasion|gift|birthday|anniversary|remember|forget|my name is|i love|i like|i prefer|i wear|light|heavy|pastel|royal|casual|formal|fabric|silk|cotton|chanderi|banarasi|kanjivaram|velvet|organza|pink|yellow|red|blue|green|white|black|beige|purple|orange|grey|gray|brown|ivory|maroon|teal|gold|golden|rose|rani)\b/i;

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatInr(n) {
  return `₹${Number(n || 0).toLocaleString("en-IN")}`;
}

function isOneEditAway(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; }
    else {
      if (++edits > 1) return false;
      if (a.length > b.length) i++;
      else if (b.length > a.length) j++;
      else { i++; j++; }
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function normalizeAndFixTypos(rawText) {
  const cleaned = String(rawText || "").toLowerCase().replace(/[?!.,]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned
    .split(" ")
    .map((w) => (w.length < 4 || VOCAB.includes(w) ? w : VOCAB.find((t) => isOneEditAway(w, t)) || w))
    .join(" ");
}

function stripFillers(text) {
  return text
    .replace(/^(?:hey |hi |hello )?(?:nira )?(?:please |pls |plz )?(?:can you |could you |would you |i want to |i wanna |just |kindly )*/i, "")
    .replace(/\s+(?:please|pls|plz|now|for me)$/i, "")
    .trim();
}

export function classifyHexColor(hex) {
  if (typeof hex !== "string" || !/^#[0-9a-f]{6}$/i.test(hex)) return null;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (l <= 0.14) return "black";
  if (l >= 0.9 && s <= 0.22) return "white";
  if (s <= 0.12) return l < 0.35 ? "black" : l > 0.8 ? "white" : "grey";
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  if (h >= 15 && h < 45 && l < 0.42) return "brown";
  if (h >= 25 && h < 55 && l > 0.72 && s < 0.45) return "beige";
  if (h < 15 || h >= 348) return l > 0.65 ? "pink" : "red";
  if (h < 42) return "orange";
  if (h < 68) return "yellow";
  if (h < 168) return "green";
  if (h < 252) return "blue";
  if (h < 305) return "purple";
  return "pink";
}

export function productMatchesColorFamily(product, askedFamily) {
  const colorField = String(product?.color || "").toLowerCase();
  const synonyms = COLOR_FAMILIES[askedFamily] || [askedFamily];
  if (synonyms.some((word) => colorField.includes(word))) return true;
  return classifyHexColor(product?.colorHex) === askedFamily;
}

function parseAmount(numStr, hasK) {
  const n = Number(numStr);
  if (!Number.isFinite(n) || n <= 0) return null;
  return hasK ? Math.round(n * 1000) : Math.round(n);
}

function extractPriceBounds(text) {
  let minPrice = null;
  let maxPrice = null;
  const between = text.match(
    /\bbetween\s*(?:rs\.?|inr|₹)?\s*(\d+(?:\.\d+)?)\s*(k)?\s*(?:and|to|-)\s*(?:rs\.?|inr|₹)?\s*(\d+(?:\.\d+)?)\s*(k)?\b/i
  );
  if (between) {
    minPrice = parseAmount(between[1], between[2]);
    maxPrice = parseAmount(between[3], between[4]);
    return { minPrice, maxPrice };
  }
  const maxM = text.match(/\b(?:under|below|less than|within|max|upto|up to)\s*(?:rs\.?|inr|₹)?\s*(\d+(?:\.\d+)?)\s*(k)?\b/i);
  if (maxM) maxPrice = parseAmount(maxM[1], maxM[2]);
  const minM = text.match(/\b(?:above|over|more than|min|starting|from)\s*(?:rs\.?|inr|₹)?\s*(\d+(?:\.\d+)?)\s*(k)?\b/i);
  if (minM) minPrice = parseAmount(minM[1], minM[2]);
  return { minPrice, maxPrice };
}

function extractExactSize(text) {
  if (/\bfree size\b/i.test(text)) return "Free Size";
  const m = text.match(/\b(?:in\s+|size\s+)?(xs|s|m|l|xl|xxl|26|28|30|32|34|36)\s*(?:size)?\b/i);
  if (!m) return null;
  const token = m[1].toUpperCase();
  if (["S", "M", "L"].includes(token) && !/\b(size|in\s+[sml]\b)/i.test(text)) return null;
  return token;
}

function formatCandidateReply(items, label, autoOpenSingle = true) {
  if (items.length === 1 && autoOpenSingle) {
    return {
      reply: `Opening ${items[0].title} (${formatInr(items[0].price)}).`,
      clientActions: [{ type: "navigate", path: `/shop/${items[0].slug}` }],
      candidates: [],
    };
  }
  const top = items.slice(0, 5);
  const list = top.map((p, i) => `${i + 1}. ${p.title} (${formatInr(p.price)})`).join("\n");
  return {
    reply: `I found ${items.length} ${label}:\n${list}\nSay "1st one" or the name to open any piece.`,
    clientActions: [],
    candidates: top.map((p, i) => ({
      position: i + 1,
      slug: p.slug,
      title: p.title,
      price: Number(p.price) || 0,
      color: p.color || "",
      colorHex: p.colorHex || "",
      fabric: p.fabric || "",
      category: p.category || "",
    })),
  };
}

/**
 * High-Precision Backend Local AI (Zero External LLM Tokens).
 * Handles ONLY deterministic storefront info, time/date, simple commands, ordinals,
 * exact product names, form dictation, and structured DB filters (category/budget/size/season).
 */
export async function tryLocalServerIntent({
  message,
  user,
  visibleItems = [],
  lastCandidates = [],
}) {
  const raw = String(message || "").trim();
  const normalized = normalizeAndFixTypos(raw);
  if (!normalized || normalized.length > 140) return null;

  const text = stripFillers(normalized);
  if (!text) return null;

  // 1. Greetings & Identity
  if (/^(hi|hello|hey|good morning|good afternoon|good evening|namaste)(\s+nira)?$/.test(normalized)) {
    return {
      reply:
        "Hello! I'm NIRA, your DIVARA shopping assistant. Ask about any piece, prices, or policies — or tell me where you'd like to go.",
      clientActions: [],
    };
  }
  if (/^(who are you|what is your name|what can you do|help)$/.test(text)) {
    return {
      reply:
        "I'm NIRA, DIVARA's shopping assistant. I can open pages, filter by category/budget/size, scroll smoothly, open products by position or name, check contact/policies/orders, and help fill forms.",
      clientActions: [],
    };
  }

  // 1b. Exact Current Time & Date (IST — 100% local, zero hallucination)
  if (/^(?:what(?:'s| is)? )?(?:the )?(?:current |local )?time(?: now| in india| right now)?$|^time(?: now)?$/.test(text)) {
    const now = new Date();
    const timeStr = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }).format(now);
    return { reply: `The current time in India is ${timeStr} IST.`, clientActions: [] };
  }
  if (/^(?:what(?:'s| is)? )?(?:today(?:'s)? )?(?:date|day)(?: today)?$|^date today$/.test(text)) {
    const now = new Date();
    const dateStr = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(now);
    return { reply: `Today is ${dateStr} (IST).`, clientActions: [] };
  }

  // 2. Smart Guest Auth Guard
  if (
    !user &&
    /\b(buy|purchase|add to (cart|bag)|put in (cart|bag)|order this|save to wishlist|add to wishlist|checkout)\b/.test(
      text
    ) &&
    !/\bhow\b/.test(text)
  ) {
    return {
      reply:
        "Please sign in first to add items to your bag, save to wishlist, or place an order. You can say 'sign in with Google' or sign in on the Account page.",
      clientActions: [{ type: "navigate", path: "/account" }],
    };
  }

  // 3. Direct Single-Field Form Dictation
  const formRules = [
    { key: "line1", rx: /^(?:write |set |put |fill )?(?:my )?address(?: line ?1| line one)? (?:as|to|is) (.+)$/i },
    { key: "line2", rx: /^(?:write |set |put |fill )?(?:my )?(?:address line ?2|address line two|landmark) (?:as|to|is) (.+)$/i },
    { key: "city", rx: /^(?:write |set |put |fill )?(?:my )?city (?:as|to|is) (.+)$/i },
    { key: "state", rx: /^(?:write |set |put |fill )?(?:my )?state (?:as|to|is) (.+)$/i },
    { key: "postalCode", rx: /^(?:write |set |put |fill )?(?:my )?(?:pin ?code|postal code|zip) (?:as|to|is) (\d{6})$/i },
    { key: "phone", rx: /^(?:write |set |put |fill )?(?:my )?(?:phone|mobile)(?: number)? (?:as|to|is) ([+\d\s-]{10,15})$/i },
    { key: "fullName", rx: /^(?:write |set |put |fill )?(?:my )?name (?:as|to|is) (.+)$/i },
  ];
  for (const rule of formRules) {
    const m = raw.match(rule.rx);
    if (m && m[1]) {
      const val = m[1].trim();
      return {
        reply: `Updated ${rule.key === "line1" ? "Address Line 1" : rule.key} to "${val}".`,
        clientActions: [{ type: "fill_form", formType: "checkout_address", fields: { [rule.key]: val } }],
      };
    }
  }

  // 4. Storefront What / Where / How FAQs
  if (/where.*(profile|account)|find my (profile|account)/.test(text)) {
    return {
      reply: "Your Profile, Saved Addresses, Wishlist, and Orders are in the Account page. Opening it for you now.",
      clientActions: [{ type: "navigate", path: "/account" }],
    };
  }
  if (/how.*add to (cart|bag)/.test(text)) {
    return {
      reply: "Sign in, open any garment, choose your size, and tap 'Add to Bag'. You can review items anytime from the Bag icon in the top bar.",
      clientActions: [],
    };
  }
  if (/how.*(apply|use).*(coupon|discount|promo)/.test(text)) {
    return {
      reply: "Open your Shopping Bag or Checkout — automatic offers apply on their own, and you can enter a manual coupon code before paying.",
      clientActions: [],
    };
  }
  if (/how.*(cookie|privacy) (setting|preference)/.test(text)) {
    return {
      reply: "You can update Cookie Preferences anytime from the footer link. Opening it for you now.",
      clientActions: [{ type: "overlay", target: "cookie_preferences" }],
    };
  }

  // Escalate negations, festivals/occasions, suggestions, colors/fabrics, or memory to external LLM
  if (EXTERNAL_ONLY_PATTERN.test(text)) return null;
  if (/\b(and|also)\b/.test(text) && !/\bbetween\b/.test(text)) return null;

  // 5. Browser History & Scroll Controls
  if (/^(go )?back( page)?$|^previous( page)?$/.test(text)) {
    return { reply: "Going back.", clientActions: [{ type: "history", direction: "back" }] };
  }
  if (/^(go )?(next|forward)( page)?$/.test(text)) {
    return { reply: "Going forward.", clientActions: [{ type: "history", direction: "forward" }] };
  }
  if (/^(stop|pause|halt)( scrolling| scroll)?$/.test(text)) {
    return { reply: "Stopped scrolling.", clientActions: [{ type: "scroll", action: "stop" }] };
  }
  if (/^scroll (slowly|slow|down slowly|till (the )?end|to (the )?end)$/.test(text)) {
    return {
      reply: "Scrolling down slowly. Say stop or touch the screen anytime to pause.",
      clientActions: [{ type: "scroll", action: "slow_down_to_end" }],
    };
  }
  if (/^(scroll (to )?(the )?top|go to top|back to top)$/.test(text)) {
    return { reply: "Scrolling to the top.", clientActions: [{ type: "scroll", action: "top" }] };
  }
  if (/^scroll (to )?(the )?bottom$/.test(text)) {
    return { reply: "Scrolling to the bottom.", clientActions: [{ type: "scroll", action: "bottom" }] };
  }
  if (/^scroll down$/.test(text)) return { reply: "Scrolling down.", clientActions: [{ type: "scroll", action: "down" }] };
  if (/^scroll up$/.test(text)) return { reply: "Scrolling up.", clientActions: [{ type: "scroll", action: "up" }] };

  // 6. Overlays & Google Sign-In
  if (/^(?:open |show |view )?(?:my |the )?(?:cart|bag|shopping bag)$/.test(text)) {
    return { reply: "Opening your Shopping Bag.", clientActions: [{ type: "overlay", target: "cart" }] };
  }
  if (/^(?:open |show )?(?:the )?search(?: bar| box| overlay)?$/.test(text)) {
    return { reply: "Opening Search.", clientActions: [{ type: "overlay", target: "search" }] };
  }
  if (/^(?:open |show )?(?:the )?cookie(?:s)?\s*(?:preferences|settings)$/.test(text)) {
    return { reply: "Opening Cookie Preferences.", clientActions: [{ type: "overlay", target: "cookie_preferences" }] };
  }
  if (/^(?:sign ?in|log ?in|sign me in|log me in)\s+(?:with|using)\s+google$/.test(text)) {
    if (user) return { reply: "You are already signed in to your DIVARA account.", clientActions: [] };
    return {
      reply: "Opening Google Sign-In so you can choose your account.",
      clientActions: [{ type: "google_signin" }],
    };
  }

  // 7. Direct Storefront Pages
  if (/^(?:open |show |go to |take me to )?(?:the )?home(?:page)?$/.test(text)) {
    return { reply: "Opening the DIVARA homepage.", clientActions: [{ type: "navigate", path: "/" }] };
  }
  if (/^(?:open |show |go to |take me to |view )?(?:the |me )?collections?(?: page)?$/.test(text)) {
    return { reply: "Opening DIVARA Collections.", clientActions: [{ type: "navigate", path: "/collections" }] };
  }
  if (/^(?:open |show |go to |take me to )?(?:the )?craftsmanship(?: page| story)?$/.test(text)) {
    return { reply: "Opening DIVARA Craftsmanship.", clientActions: [{ type: "navigate", path: "/craftsmanship" }] };
  }
  if (/^(?:open |show |go to |take me to )?(?:the )?contact(?: us)?(?: page)?$/.test(text)) {
    return { reply: "Opening the Contact page.", clientActions: [{ type: "navigate", path: "/contact" }] };
  }
  if (/^(?:open |show |go to |take me to )?(?:my |the )?(?:account|profile)(?: page)?$/.test(text)) {
    return { reply: "Opening your Account page.", clientActions: [{ type: "navigate", path: "/account" }] };
  }
  if (/^(?:open |show |go to |take me to )?(?:the )?checkout(?: page)?$/.test(text)) {
    return { reply: "Taking you to Checkout.", clientActions: [{ type: "navigate", path: "/checkout" }] };
  }

  // 8. Live Storefront Info (Contact, Policies, Bag, Coupons, Orders)
  if (/\b(contact|phone|number|email|call|helpline|support hours?|boutique|store location|where is divara)\b/.test(text)) {
    const content = await SiteContent.findOne({ key: "global" }).select("contact").lean();
    const email = content?.contact?.email || "support@divara.byfalguni.com";
    const phone = content?.contact?.phone || "+91 (033) 2284-9100";
    const hours = content?.contact?.supportHours || "Monday – Saturday, 10:00 AM to 8:00 PM IST";
    const cities = (content?.contact?.locations || ["Kolkata", "Mumbai", "New Delhi"]).join(", ");
    return {
      reply: `You can reach DIVARA at ${email} or ${phone} (${hours}). Our ateliers are in ${cities}.`,
      clientActions: /\b(open|go to|show)\b/.test(text) ? [{ type: "navigate", path: "/contact" }] : [],
    };
  }

  if (/\b(return|refund|exchange|shipping|delivery time|privacy policy|terms of service)\b/.test(text)) {
    const slug = /\bprivacy\b/.test(text)
      ? "privacy-policy"
      : /\bterms\b/.test(text)
      ? "terms-of-service"
      : "shipping-returns";
    const page = await PolicyPage.findOne({ slug, isPublished: true }).select("title summary sections").lean();
    if (!page) return null;
    const snippet = page.summary || page.sections?.[0]?.body?.slice(0, 220) || "";
    return {
      reply: `${page.title}: ${snippet}`,
      clientActions: /\b(open|show|read)\b/.test(text) ? [{ type: "navigate", path: `/policies/${slug}` }] : [],
    };
  }

  if (/\b(my bag|my cart|in my bag|in my cart|bag total|cart total)\b/.test(text)) {
    if (!user) {
      return { reply: "Please sign in to view your saved shopping bag.", clientActions: [{ type: "navigate", path: "/account" }] };
    }
    const bag = await Bag.findOne({ userId: user._id }).lean();
    const items = bag?.items || [];
    if (items.length === 0) return { reply: "Your shopping bag is currently empty.", clientActions: [] };
    const total = items.reduce((s, i) => s + (i.price || 0) * (i.quantity || 1), 0);
    const list = items.slice(0, 4).map((i) => `${i.title} (${i.size}) x${i.quantity}`).join(", ");
    return {
      reply: `You have ${items.length} item${items.length > 1 ? "s" : ""} in your bag (${list}) — subtotal ${formatInr(total)}.`,
      clientActions: [{ type: "overlay", target: "cart" }],
    };
  }

  if (/\b(coupon|coupons|discount|promo|offer|offers)\b/.test(text) && !/\bhow\b/.test(text)) {
    const now = new Date();
    const offers = await Coupon.find({
      isActive: true,
      applyMode: "AUTO",
      startsAt: { $lte: now },
      $or: [{ endsAt: null }, { endsAt: { $gte: now } }],
    })
      .select("code discountType discountValue")
      .limit(3)
      .lean();
    if (offers.length === 0) {
      return { reply: "No automatic offers are active right now, though you can enter a manual coupon code at Checkout.", clientActions: [] };
    }
    const summary = offers
      .map((c) => `${c.code} (${c.discountType === "PERCENTAGE" ? `${c.discountValue}% off` : `${formatInr(c.discountValue)} off`})`)
      .join(", ");
    return { reply: `Active automatic offers: ${summary}.`, clientActions: [] };
  }

  if (/\b(my orders?|order status|track( my)? order|past orders?)\b/.test(text)) {
    if (!user) {
      return { reply: "Please sign in to check your orders and live delivery status.", clientActions: [{ type: "navigate", path: "/account" }] };
    }
    const orders = await Order.find({ userId: user._id })
      .select("orderNumber status totalPaise")
      .sort({ createdAt: -1 })
      .limit(3)
      .lean();
    if (orders.length === 0) return { reply: "You don't have any orders placed yet.", clientActions: [] };
    const lines = orders.map((o) => `${o.orderNumber} (${o.status}, ${formatInr(Math.round((o.totalPaise || 0) / 100))})`);
    return { reply: `Your recent orders: ${lines.join(" · ")}.`, clientActions: [{ type: "navigate", path: "/account" }] };
  }

  // 9. Exact Ordinal Selection (1st, 2nd, 3rd, 4th product...)
  const activePool = lastCandidates.length > 0 ? lastCandidates : visibleItems;

  const ordPriceMatch = text.match(/^(?:what is |whats )?(?:the )?(?:price|cost) of (?:the )?(\w+)(?: product| item| piece| one)?$/);
  if (ordPriceMatch && ORDINAL_MAP[ordPriceMatch[1]]) {
    const target = activePool[ORDINAL_MAP[ordPriceMatch[1]] - 1];
    if (target) return { reply: `${target.title} is priced at ${formatInr(target.price)}.`, clientActions: [] };
  }

  const ordOpenMatch = text.match(/^(?:(?:open|show|view|click)\s+)?(?:the\s+)?(\w+)(?:\s+(?:product|item|piece|one))?$/);
  if (ordOpenMatch && ORDINAL_MAP[ordOpenMatch[1]]) {
    const target = activePool[ORDINAL_MAP[ordOpenMatch[1]] - 1];
    if (target?.slug) {
      return {
        reply: `Opening ${target.title}.`,
        clientActions: [{ type: "navigate", path: `/shop/${target.slug}` }],
        candidates: [],
      };
    }
  }

  // 10. Direct Product Price / Stock by Exact Name
  const priceMatch = text.match(/^(?:what is |whats |tell me )?(?:the )?(?:price|cost|rate|stock|availability) of (.+?)(?: product| piece| item)?$/);
  if (priceMatch && priceMatch[1]) {
    const term = priceMatch[1].trim();
    const product = await Product.findOne({
      isPublished: true,
      $or: [{ slug: term.replace(/\s+/g, "-") }, { title: new RegExp(escapeRegex(term), "i") }],
    })
      .select("slug title price variants.size variants.stockOnHand variants.stockReserved")
      .lean();
    if (product) {
      const sizes = (product.variants || [])
        .filter((v) => (v.stockOnHand || 0) - (v.stockReserved || 0) > 0)
        .map((v) => v.size);
      return {
        reply: `${product.title} is priced at ${formatInr(product.price)}. ${
          sizes.length > 0 ? `Available sizes: ${sizes.join(", ")}.` : "Currently out of stock."
        }`,
        clientActions: [],
      };
    }
  }

  // 11. Structured Multi-Filter Search (Category + Budget + Size + Season — Exact Schema Match)
  const words = text.split(" ");
  const catKey = words.find((w) => CATEGORY_MAP[w]);
  const category = catKey ? CATEGORY_MAP[catKey] : null;
  const seasonKey = words.find((w) => SEASON_MAP[w]);
  const season = seasonKey ? SEASON_MAP[seasonKey] : null;
  const size = extractExactSize(text);
  const { minPrice, maxPrice } = extractPriceBounds(text);

  if (category || season || size || minPrice || maxPrice) {
    if ((category || season) && !size && !minPrice && !maxPrice) {
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      if (season) params.set("season", season);
      const label = [season, category ? CATEGORY_LABELS[category] : "pieces"].filter(Boolean).join(" ");
      return {
        reply: `Showing ${label} in Collections.`,
        clientActions: [{ type: "navigate", path: `/collections?${params.toString()}` }],
        candidates: [],
      };
    }

    const dbFilter = { isPublished: true };
    if (category) dbFilter.category = category;
    if (season) dbFilter.season = season;
    if (minPrice || maxPrice) {
      dbFilter.price = {};
      if (minPrice) dbFilter.price.$gte = minPrice;
      if (maxPrice) dbFilter.price.$lte = maxPrice;
    }

    let items = await Product.find(dbFilter)
      .select("slug title price color colorHex fabric category variants.size variants.stockOnHand variants.stockReserved")
      .sort({ isFeatured: -1, price: 1 })
      .limit(size ? 60 : 5)
      .lean();

    if (size) {
      items = items
        .filter((p) =>
          (p.variants || []).some(
            (v) => v.size === size && (v.stockOnHand || 0) - (v.stockReserved || 0) > 0
          )
        )
        .slice(0, 5);
    }

    const parts = [
      season,
      category ? CATEGORY_LABELS[category] : "pieces",
      size ? `in size ${size}` : null,
      minPrice && maxPrice
        ? `between ${formatInr(minPrice)} and ${formatInr(maxPrice)}`
        : maxPrice
        ? `under ${formatInr(maxPrice)}`
        : minPrice
        ? `above ${formatInr(minPrice)}`
        : null,
    ].filter(Boolean);
    const label = parts.join(" ");

    if (items.length === 0) {
      return { reply: `No ${label} are currently in stock.`, clientActions: [], candidates: [] };
    }
    return formatCandidateReply(items, label, false);
  }

  // 12. Direct Product Open by Exact / Clear Name
  const openNamed = text.match(/^(?:open|show|view)\s+(?:the\s+|that\s+)?(.+?)(?:\s+product|\s+piece|\s+item)?$/);
  if (openNamed && openNamed[1]) {
    const q = openNamed[1].trim();
    if (q.length >= 4 && !CATEGORY_MAP[q]) {
      const poolMatches = activePool.filter((p) => p.title?.toLowerCase().includes(q));
      if (poolMatches.length > 0) return formatCandidateReply(poolMatches, `matching "${q}"`, true);

      const dbHits = await Product.find({ isPublished: true, title: new RegExp(escapeRegex(q), "i") })
        .select("slug title price color colorHex fabric category")
        .limit(5)
        .lean();
      if (dbHits.length > 0) return formatCandidateReply(dbHits, `matching "${q}"`, true);
    }
  }

  return null;
}