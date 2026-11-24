import { Product, CATEGORY_LABELS } from "../models/Product.js";
import { SiteContent } from "../models/SiteContent.js";
import { PolicyPage } from "../models/PolicyPage.js";
import { Review } from "../models/Review.js";
import { Bag } from "../models/Bag.js";
import { Coupon } from "../models/Coupon.js";
import { Order } from "../models/Order.js";
import { User } from "../models/User.js";
import {
  AiMemory,
  getVisitorExpiryDate,
  sanitizeMemoryPatch,
} from "../models/AiMemory.js";
import {
  COLOR_FAMILIES,
  productMatchesColorFamily,
} from "./aiLocalResponder.service.js";

// Whitelist-only storefront & customer tools. Zero admin/internal tools exist here.
export const AI_TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "search_products",
      description:
        "Search DIVARA's live published catalog by keyword, color, category, fabric, size, or max price in INR.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search words like pink, silk, banarasi, kurta, ivory" },
          category: { type: "string", enum: Object.keys(CATEGORY_LABELS) },
          maxPriceInr: { type: "number", description: "Maximum price in INR" },
          size: { type: "string", description: "Preferred size like S, M, L, XL, Free Size" },
          limit: { type: "number", description: "Number of results (1-8)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_product_details",
      description:
        "Fetch live price, description, color, fabric, available sizes, stock status, and top review summary for a specific garment by slug or name.",
      parameters: {
        type: "object",
        properties: {
          slugOrName: { type: "string", description: "Garment slug or title" },
        },
        required: ["slugOrName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_contact_and_brand_info",
      description:
        "Fetch DIVARA's live customer support email, phone, hours, boutique cities, FAQs, and craftsmanship highlights.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_store_policy",
      description:
        "Fetch DIVARA's live Privacy Policy, Terms of Service, or Shipping & Returns policy.",
      parameters: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            enum: ["shipping-returns", "privacy-policy", "terms-of-service"],
          },
        },
        required: ["topic"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_bag_and_coupons",
      description:
        "Get the signed-in customer's current shopping bag items, subtotal, and active auto-applicable offers.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_orders",
      description:
        "Get the signed-in customer's recent orders or check status of a specific order number.",
      parameters: {
        type: "object",
        properties: {
          orderNumber: { type: "string", description: "Optional specific order number" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_saved_addresses",
      description:
        "Fetch the signed-in customer's profile name, phone, and saved shipping addresses before filling an address form.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "save_shopper_memory",
      description:
        "Save lasting shopping preferences or milestones shared by the shopper (birthday month/day, anniversary, size, fit, colors, fabrics, style likes/dislikes, budget, occasion, city, payment preference). Only call when personalization consent is enabled.",
      parameters: {
        type: "object",
        properties: {
          preferredName: { type: "string" },
          birthday: {
            type: "object",
            properties: { month: { type: "number" }, day: { type: "number" } },
          },
          anniversary: {
            type: "object",
            properties: { month: { type: "number" }, day: { type: "number" } },
          },
          preferredSize: { type: "string" },
          preferredFit: { type: "string" },
          favoriteColors: { type: "array", items: { type: "string" } },
          favoriteFabrics: { type: "array", items: { type: "string" } },
          styleLikes: { type: "array", items: { type: "string" } },
          styleDislikes: { type: "array", items: { type: "string" } },
          budgetMaxInr: { type: "number" },
          upcomingOccasion: { type: "string" },
          city: { type: "string" },
          preferredPayment: { type: "string", enum: ["razorpay", "cod"] },
          notes: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
  // --- Client-Side UI Action Tools ---
  {
    type: "function",
    function: {
      name: "navigate_to_page",
      description:
        "Navigate the shopper's browser to a DIVARA storefront page (home, collections, product page, craftsmanship, contact, account, checkout, or policy page).",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Storefront path starting with / such as /, /collections, /collections?category=saree, /shop/ivory-saree, /contact, /craftsmanship, /account, /checkout, /policies/shipping-returns",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_history",
      description: "Go back or forward in browser history.",
      parameters: {
        type: "object",
        properties: {
          direction: { type: "string", enum: ["back", "forward"] },
        },
        required: ["direction"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "scroll_page",
      description:
        "Scroll the current page smoothly down to the bottom, up to the top, down/up one screen, or stop scrolling.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["slow_down_to_end", "down", "up", "top", "bottom", "stop"],
          },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "open_visible_product",
      description:
        "Open a product currently visible on screen by its 1-based position (e.g., 4 for 'the 4th product').",
      parameters: {
        type: "object",
        properties: {
          position: { type: "number", description: "1-based index on screen (e.g. 1, 2, 3, 4)" },
        },
        required: ["position"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "open_overlay",
      description:
        "Open a storefront overlay such as the Shopping Bag drawer, Search bar (optionally filling and running a search query), or Cookie Preferences.",
      parameters: {
        type: "object",
        properties: {
          target: { type: "string", enum: ["cart", "search", "cookie_preferences"] },
          query: { type: "string", description: "Optional search text to type into Search bar and search" },
        },
        required: ["target"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "trigger_google_signin",
      description:
        "Start DIVARA's Google Sign-In flow (behaves like clicking 'Sign in with Google'; opens Google's account chooser for the shopper to pick their account).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "fill_form_fields",
      description:
        "Fill fields into the active Checkout shipping address, Account address, or Contact form on screen.",
      parameters: {
        type: "object",
        properties: {
          formType: { type: "string", enum: ["checkout_address", "account_address", "contact"] },
          fields: {
            type: "object",
            description:
              "Key-value pairs such as fullName, phone, email, line1, line2, city, state, postalCode, label, subject, message",
          },
        },
        required: ["formType", "fields"],
      },
    },
  },
];

const ALLOWED_PATH_PREFIXES = [
  "/",
  "/collections",
  "/shop/",
  "/craftsmanship",
  "/contact",
  "/account",
  "/checkout",
  "/policies/",
];

function isSafeStorefrontPath(rawPath) {
  if (typeof rawPath !== "string") return false;
  const p = rawPath.trim();
  if (!p.startsWith("/") || p.startsWith("//")) return false;
  if (p.toLowerCase().includes("admin")) return false;
  if (p === "/") return true;
  return ALLOWED_PATH_PREFIXES.some((prefix) => prefix !== "/" && p.startsWith(prefix));
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function executeStorefrontTool(toolName, rawArgs, context) {
  const args = rawArgs && typeof rawArgs === "object" ? rawArgs : {};
  const { user, deviceId, personalizationAllowed, visibleItems, clientActions, flags } = context;

  switch (toolName) {
    case "search_products": {
      const filter = { isPublished: true };
      if (args.category && CATEGORY_LABELS[args.category]) {
        filter.category = args.category;
      }
      if (args.maxPriceInr && Number(args.maxPriceInr) > 0) {
        filter.price = { $lte: Number(args.maxPriceInr) };
      }

      const rawQ = String(args.query || "").trim().toLowerCase();
      const matchedColorFam = Object.keys(COLOR_FAMILIES).find((fam) =>
        rawQ.split(/\s+/).some((w) => w === fam || COLOR_FAMILIES[fam].includes(w))
      );

      // Avoid matching color words inside description text (e.g., "blush-pink lotuses" on a Teal lehenga)
      if (rawQ && !matchedColorFam) {
        const rx = new RegExp(escapeRegex(rawQ), "i");
        filter.$or = [{ title: rx }, { category: rx }, { fabric: rx }, { season: rx }, { color: rx }];
      }

      const limit = Math.min(8, Math.max(1, Number(args.limit) || 5));
      let items = await Product.find(filter)
        .select(
          "slug title category price color colorHex fabric variants.size variants.stockOnHand variants.stockReserved"
        )
        .sort({ isFeatured: -1, createdAt: -1 })
        .limit(matchedColorFam ? 80 : limit)
        .lean();

      if (matchedColorFam) {
        items = items.filter((p) => productMatchesColorFamily(p, matchedColorFam)).slice(0, limit);
      }

      if (args.size && String(args.size).trim()) {
        const wantedSize = String(args.size).trim().toLowerCase();
        items = items.filter((p) =>
          (p.variants || []).some(
            (v) =>
              String(v.size || "").toLowerCase() === wantedSize &&
              (v.stockOnHand || 0) - (v.stockReserved || 0) > 0
          )
        );
      }

      const results = items.map((p) => {
        const availableSizes = (p.variants || [])
          .filter((v) => (v.stockOnHand || 0) - (v.stockReserved || 0) > 0)
          .map((v) => v.size);
        return {
          title: p.title,
          slug: p.slug,
          category: CATEGORY_LABELS[p.category] || p.category,
          color: p.color || "",
          fabric: p.fabric || "",
          priceInr: p.price,
          availableSizes,
          inStock: availableSizes.length > 0,
        };
      });

      return { count: results.length, products: results };
    }

    case "get_product_details": {
      const term = String(args.slugOrName || "").trim();
      if (!term) return { found: false };
      const rx = new RegExp(escapeRegex(term), "i");
      const product = await Product.findOne({
        isPublished: true,
        $or: [{ slug: term.toLowerCase() }, { title: rx }],
      })
        .select("slug title category price color fabric description craftNotes season variants")
        .lean();

      if (!product) return { found: false, message: "No matching garment found." };

      const reviews = await Review.find({ productId: product._id, status: "approved" })
        .select("rating comment")
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();

      const avgRating =
        reviews.length > 0
          ? Number((reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length).toFixed(1))
          : null;

      return {
        found: true,
        title: product.title,
        slug: product.slug,
        category: CATEGORY_LABELS[product.category] || product.category,
        color: product.color || "",
        fabric: product.fabric || "",
        priceInr: product.price,
        description: String(product.description || "").slice(0, 400),
        craftNotes: (product.craftNotes || []).slice(0, 4),
        sizes: (product.variants || []).map((v) => ({
          size: v.size,
          available: Math.max(0, (v.stockOnHand || 0) - (v.stockReserved || 0)),
        })),
        reviewCount: reviews.length,
        averageRating: avgRating,
      };
    }

    case "get_contact_and_brand_info": {
      const content = await SiteContent.findOne({ key: "global" })
        .select("contact philosophy.heading philosophy.paragraphs")
        .lean();
      return {
        email: content?.contact?.email || "support@divara.byfalguni.com",
        phone: content?.contact?.phone || "+91 (033) 2284-9100",
        supportHours: content?.contact?.supportHours || "Monday – Saturday, 10:00 AM to 8:00 PM IST",
        locations: content?.contact?.locations || ["Kolkata", "Mumbai", "New Delhi"],
        faqs: (content?.contact?.faqs || []).slice(0, 6),
        craftsmanshipSummary: (content?.philosophy?.paragraphs || []).slice(0, 2).join(" "),
      };
    }

    case "get_store_policy": {
      const allowed = new Set(["shipping-returns", "privacy-policy", "terms-of-service"]);
      const slug = allowed.has(args.topic) ? args.topic : "shipping-returns";
      const page = await PolicyPage.findOne({ slug, isPublished: true })
        .select("title summary effectiveDate sections")
        .lean();
      if (!page) return { found: false };
      return {
        found: true,
        title: page.title,
        effectiveDate: page.effectiveDate,
        summary: page.summary,
        sections: (page.sections || []).slice(0, 5).map((s) => ({
          heading: s.heading,
          body: String(s.body || "").slice(0, 280),
        })),
      };
    }

    case "get_my_bag_and_coupons": {
      if (!user) {
        return { signedIn: false, message: "Please sign in to check your personal bag and offers." };
      }
      const bag = await Bag.findOne({ userId: user._id }).lean();
      const items = (bag?.items || []).map((i) => ({
        title: i.title,
        size: i.size,
        quantity: i.quantity,
        priceInr: i.price,
      }));
      const subtotalInr = items.reduce((sum, i) => sum + i.priceInr * i.quantity, 0);

      const now = new Date();
      const autoCoupons = await Coupon.find({
        isActive: true,
        applyMode: "AUTO",
        startsAt: { $lte: now },
        $or: [{ endsAt: null }, { endsAt: { $gte: now } }],
      })
        .select("code name description discountType discountValue")
        .limit(3)
        .lean();

      return { signedIn: true, itemCount: items.length, subtotalInr, items, activeOffers: autoCoupons };
    }

    case "get_my_orders": {
      if (!user) {
        return { signedIn: false, message: "Please sign in to view your orders." };
      }
      const query = { userId: user._id };
      if (args.orderNumber) {
        query.orderNumber = String(args.orderNumber).trim().toUpperCase();
      }
      const orders = await Order.find(query)
        .select(
          "orderNumber status paymentStatus paymentMethod totalPaise items.title items.size items.quantity createdAt"
        )
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();

      return {
        signedIn: true,
        orders: orders.map((o) => ({
          orderNumber: o.orderNumber,
          status: o.status,
          paymentStatus: o.paymentStatus,
          paymentMethod: o.paymentMethod,
          totalInr: Math.round((o.totalPaise || 0) / 100),
          items: (o.items || []).map((i) => `${i.title} (${i.size}) x${i.quantity}`),
          orderedOn: new Date(o.createdAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }),
        })),
      };
    }

    case "get_my_saved_addresses": {
      if (!user) {
        return { signedIn: false, message: "Please sign in to access saved addresses." };
      }
      const doc = await User.findById(user._id).select("fullName email phone addresses").lean();
      return {
        signedIn: true,
        profileName: doc?.fullName || "",
        phone: doc?.phone || "",
        addresses: (doc?.addresses || []).map((a) => ({
          label: a.label,
          fullName: a.fullName,
          phone: a.phone,
          line1: a.line1,
          line2: a.line2,
          city: a.city,
          state: a.state,
          postalCode: a.postalCode,
          isDefault: Boolean(a.isDefault),
        })),
      };
    }

    case "save_shopper_memory": {
      if (!personalizationAllowed) {
        return {
          saved: false,
          reason: "Personalization consent is currently off. Keep preference for this chat only.",
        };
      }
      const identityFilter = user
        ? { userId: user._id }
        : deviceId
        ? { userId: null, deviceId }
        : null;
      if (!identityFilter) return { saved: false };

      const { patch, arrays } = sanitizeMemoryPatch(args);
      if (Object.keys(patch).length === 0 && Object.keys(arrays).length === 0) {
        return { saved: false, reason: "No eligible preference fields to save." };
      }

      const updateDoc = { $set: { ...patch } };
      updateDoc.$set.expiresAt = user ? null : getVisitorExpiryDate();

      if (Object.keys(arrays).length > 0) {
        updateDoc.$addToSet = {};
        for (const [k, vals] of Object.entries(arrays)) {
          updateDoc.$addToSet[k] = { $each: vals };
        }
      }

      await AiMemory.findOneAndUpdate(identityFilter, updateDoc, {
        upsert: true,
        returnDocument: "after",
        setDefaultsOnInsert: true,
      });
      flags.memoryUpdated = true;
      return { saved: true };
    }

    // --- Client UI Actions ---
    case "navigate_to_page": {
      const path = String(args.path || "").trim();
      if (!isSafeStorefrontPath(path)) {
        return { ok: false, message: "That page is not available in the storefront." };
      }
      clientActions.push({ type: "navigate", path });
      return { ok: true, navigatedTo: path };
    }

    case "browser_history": {
      const direction = args.direction === "forward" ? "forward" : "back";
      clientActions.push({ type: "history", direction });
      return { ok: true, direction };
    }

    case "scroll_page": {
      const allowed = new Set(["slow_down_to_end", "down", "up", "top", "bottom", "stop"]);
      const action = allowed.has(args.action) ? args.action : "slow_down_to_end";
      clientActions.push({ type: "scroll", action });
      return { ok: true, action };
    }

    case "open_visible_product": {
      const pos = Math.round(Number(args.position));
      const list = Array.isArray(visibleItems) ? visibleItems : [];
      const match =
        list.find((item, idx) => Number(item.position || idx + 1) === pos) || list[pos - 1];
      if (!match || !match.slug) {
        return {
          ok: false,
          message: `There are only ${list.length} products currently visible on screen.`,
        };
      }
      const path = `/shop/${match.slug}`;
      clientActions.push({ type: "navigate", path });
      return { ok: true, openedTitle: match.title, path };
    }

    case "open_overlay": {
      const allowed = new Set(["cart", "search", "cookie_preferences"]);
      const target = allowed.has(args.target) ? args.target : "cart";
      const query = target === "search" && typeof args.query === "string" ? args.query.trim().slice(0, 100) : "";
      clientActions.push(query ? { type: "overlay", target, query } : { type: "overlay", target });
      return { ok: true, target, ...(query ? { query } : {}) };
    }

    case "trigger_google_signin": {
      if (user) {
        return { ok: false, message: "You are already signed in to your DIVARA account." };
      }
      clientActions.push({ type: "google_signin" });
      return { ok: true, message: "Opening Google Sign-In so you can choose your account." };
    }

    case "fill_form_fields": {
      const allowedForms = new Set(["checkout_address", "account_address", "contact"]);
      const formType = allowedForms.has(args.formType) ? args.formType : "checkout_address";
      const safeFields = {};
      const allowedFieldKeys = new Set([
        "label",
        "fullName",
        "phone",
        "email",
        "line1",
        "line2",
        "city",
        "state",
        "postalCode",
        "subject",
        "message",
      ]);
      for (const [k, v] of Object.entries(args.fields || {})) {
        if (allowedFieldKeys.has(k) && typeof v === "string" && v.trim()) {
          safeFields[k] = v.trim().slice(0, 300);
        }
      }
      clientActions.push({ type: "fill_form", formType, fields: safeFields });
      return { ok: true, formType, filledFields: Object.keys(safeFields) };
    }

    default:
      return { ok: false, message: "Action not supported." };
  }
}