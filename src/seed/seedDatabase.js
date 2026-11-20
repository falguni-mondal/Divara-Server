import { connectDatabase, disconnectDatabase } from "../config/db.js";
import { Product } from "../models/Product.js";
import { SiteContent } from "../models/SiteContent.js";
import { PolicyPage } from "../models/PolicyPage.js";
import { User } from "../models/User.js";

const SEED_PRODUCTS = [
  {
    slug: "arundhati-kanjivaram-saree",
    title: "Arundhati Zari Kanjivaram Saree",
    category: "saree",
    categoryLabel: "Sarees",
    season: "Winter",
    color: "Maroon",
    colorHex: "#5d100a",
    fabric: "Silk",
    price: 48500,
    isFeatured: true,
    sortOrder: 1,
    imageMedia: { url: "/images/saree_poster.webp", fileId: null },
    galleryMedia: [
      { url: "/images/saree_poster.webp", fileId: null },
      { url: "/test/main.webp", fileId: null },
      { url: "/test/model closeup.webp", fileId: null },
      { url: "/test/cloth closeup.webp", fileId: null },
      { url: "/test/cloth back.webp", fileId: null },
    ],
    description:
      "Handwoven pure mulberry silk Kanjivaram saree featuring classic temple borders and fine zari work.",
    craftNotes: [
      "100% pure mulberry silk weave.",
      "Handwoven border and pallu.",
      "Includes matching unstitched blouse piece.",
    ],
    variants: [{ size: "Free Size", sku: "DIV-SAR-ARU-FS", stockOnHand: 8, stockReserved: 0 }],
  },
  {
    slug: "maharani-velvet-drape-dress",
    title: "Maharani Silk-Velvet Evening Dress",
    category: "dress",
    categoryLabel: "Dresses",
    season: "Winter",
    color: "Black",
    colorHex: "#1b1717",
    fabric: "Velvet",
    price: 36900,
    isFeatured: true,
    sortOrder: 2,
    imageMedia: { url: "/images/dress_poster.webp", fileId: null },
    galleryMedia: [
      { url: "/images/dress_poster.webp", fileId: null },
      { url: "/test/model.webp", fileId: null },
      { url: "/test/closeup.webp", fileId: null },
      { url: "/test/cloth closeup.webp", fileId: null },
      { url: "/test/cloth back.webp", fileId: null },
    ],
    description:
      "Fluid bias-cut evening dress crafted from micro silk-velvet with soft tonal detailing along the neckline.",
    craftNotes: [
      "Pure silk-viscose velvet exterior.",
      "Soft breathable silk lining.",
      "Concealed back fastening.",
    ],
    variants: ["XS", "S", "M", "L", "XL"].map((size) => ({
      size,
      sku: `DIV-DRS-MAH-${size}`,
      stockOnHand: 6,
      stockReserved: 0,
    })),
  },
  {
    slug: "nizam-tussar-atelier-shirt",
    title: "Nizam Hand-Spun Tussar Silk Shirt",
    category: "shirt",
    categoryLabel: "Shirts",
    season: "Summer",
    color: "Ivory",
    colorHex: "#edebdd",
    fabric: "Silk",
    price: 18500,
    isFeatured: true,
    sortOrder: 3,
    imageMedia: { url: "/images/shirt_poster.webp", fileId: null },
    galleryMedia: [
      { url: "/images/shirt_poster.webp", fileId: null },
      { url: "/test/main.webp", fileId: null },
      { url: "/test/closeup.webp", fileId: null },
      { url: "/test/cloth closeup.webp", fileId: null },
      { url: "/test/cloth back.webp", fileId: null },
    ],
    description:
      "Relaxed-fit shirt tailored from pure Bhagalpuri tussar silk with natural mother-of-pearl buttons.",
    craftNotes: [
      "100% hand-spun tussar silk.",
      "Clean French-seamed interior.",
      "Natural mother-of-pearl buttons.",
    ],
    variants: ["XS", "S", "M", "L", "XL"].map((size) => ({
      size,
      sku: `DIV-SHT-NIZ-${size}`,
      stockOnHand: 10,
      stockReserved: 0,
    })),
  },
  {
    slug: "kutch-indigo-selvedge-denim",
    title: "Kutch Natural Indigo Denim Jacket",
    category: "denim",
    categoryLabel: "Denim Wears",
    season: "Winter",
    color: "Indigo",
    colorHex: "#26364d",
    fabric: "Cotton Denim",
    price: 27400,
    isFeatured: true,
    sortOrder: 4,
    imageMedia: { url: "/images/denim_poster.webp", fileId: null },
    galleryMedia: [
      { url: "/images/denim_poster.webp", fileId: null },
      { url: "/test/cloth closeup.webp", fileId: null },
      { url: "/test/model.webp", fileId: null },
      { url: "/test/closeup.webp", fileId: null },
      { url: "/test/cloth back.webp", fileId: null },
    ],
    description:
      "Structured selvedge denim jacket dyed in natural indigo vats with subtle tonal stitch detailing.",
    craftNotes: [
      "13.5oz organic cotton selvedge denim.",
      "Natural indigo dye.",
      "Custom metal hardware.",
    ],
    variants: ["XS", "S", "M", "L", "XL"].map((size) => ({
      size,
      sku: `DIV-DNM-KUT-${size}`,
      stockOnHand: 7,
      stockReserved: 0,
    })),
  },
  {
    slug: "devika-banarasi-brocade-saree",
    title: "Devika Katan Banarasi Saree",
    category: "saree",
    categoryLabel: "Sarees",
    season: "Autumn",
    color: "Gold",
    colorHex: "#b69148",
    fabric: "Silk",
    price: 62000,
    isFeatured: true,
    sortOrder: 5,
    imageMedia: { url: "/test/main.webp", fileId: null },
    galleryMedia: [
      { url: "/test/main.webp", fileId: null },
      { url: "/images/saree_poster.webp", fileId: null },
      { url: "/test/model closeup.webp", fileId: null },
      { url: "/test/cloth closeup.webp", fileId: null },
      { url: "/test/cloth back.webp", fileId: null },
    ],
    description:
      "Traditional Kadwa weave Banarasi katan silk saree with intricate floral motifs.",
    craftNotes: [
      "Handwoven in Varanasi.",
      "100% pure katan mulberry silk.",
      "Antique gold-toned zari border.",
    ],
    variants: [{ size: "Free Size", sku: "DIV-SAR-DEV-FS", stockOnHand: 5, stockReserved: 0 }],
  },
  {
    slug: "zoya-chanderi-draped-midi",
    title: "Zoya Pleated Chanderi Dress",
    category: "dress",
    categoryLabel: "Dresses",
    season: "Spring",
    color: "Ivory",
    colorHex: "#edebdd",
    fabric: "Chanderi",
    price: 31500,
    isFeatured: false,
    sortOrder: 6,
    imageMedia: { url: "/test/model.webp", fileId: null },
    galleryMedia: [
      { url: "/test/model.webp", fileId: null },
      { url: "/images/dress_poster.webp", fileId: null },
      { url: "/test/closeup.webp", fileId: null },
      { url: "/test/cloth back.webp", fileId: null },
    ],
    description:
      "Lightweight Chanderi silk-cotton dress featuring delicate micro-pleats and a fluid silhouette.",
    craftNotes: [
      "Handwoven Chanderi silk-cotton blend.",
      "Steam-set pleats.",
      "Soft mulmul lining.",
    ],
    variants: ["XS", "S", "M", "L"].map((size) => ({
      size,
      sku: `DIV-DRS-ZOY-${size}`,
      stockOnHand: 8,
      stockReserved: 0,
    })),
  },
  {
    slug: "rewa-crimson-chanderi-shirt",
    title: "Rewa Maroon Silk-Chanderi Shirt",
    category: "shirt",
    categoryLabel: "Shirts",
    season: "Autumn",
    color: "Maroon",
    colorHex: "#5d100a",
    fabric: "Chanderi",
    price: 21500,
    isFeatured: false,
    sortOrder: 7,
    imageMedia: { url: "/test/closeup.webp", fileId: null },
    galleryMedia: [
      { url: "/test/closeup.webp", fileId: null },
      { url: "/images/shirt_poster.webp", fileId: null },
      { url: "/test/cloth closeup.webp", fileId: null },
    ],
    description:
      "Crisp evening shirt crafted from lustrous maroon Chanderi silk with concealed placket.",
    craftNotes: [
      "Pure Chanderi silk weave.",
      "Concealed front button placket.",
      "Tailored cuffs and collar.",
    ],
    variants: ["S", "M", "L", "XL"].map((size) => ({
      size,
      sku: `DIV-SHT-REW-${size}`,
      stockOnHand: 9,
      stockReserved: 0,
    })),
  },
  {
    slug: "aravali-raw-denim-trouser",
    title: "Aravali Wide-Leg Raw Denim",
    category: "denim",
    categoryLabel: "Denim Wears",
    season: "Spring",
    color: "Black",
    colorHex: "#1b1717",
    fabric: "Cotton Denim",
    price: 23900,
    isFeatured: false,
    sortOrder: 8,
    imageMedia: { url: "/test/cloth back.webp", fileId: null },
    galleryMedia: [
      { url: "/test/cloth back.webp", fileId: null },
      { url: "/images/denim_poster.webp", fileId: null },
      { url: "/test/cloth closeup.webp", fileId: null },
    ],
    description:
      "High-waisted wide-leg denim trousers cut for a clean, elongated drape.",
    craftNotes: [
      "12oz organic cotton denim.",
      "High-rise tailored waistband.",
      "Deep side seam pockets.",
    ],
    variants: ["XS", "S", "M", "L"].map((size) => ({
      size,
      sku: `DIV-DNM-ARA-${size}`,
      stockOnHand: 8,
      stockReserved: 0,
    })),
  },
];

const SEED_SITE_CONTENT = {
  key: "global",
  hero: {
    desktopImage: { url: "/bg/hero.webp", fileId: null },
    mobileImage: { url: "/bg/hero_mobile_2.webp", fileId: null },
    ctaLabel: "SHOP NOW",
    scrollPrompt: "Scroll to Discover More",
  },
  categories: [
    { id: "saree", title: "Sarees", poster: { url: "/images/saree_poster.webp", fileId: null }, path: "/collections?category=saree" },
    { id: "dress", title: "Dresses", poster: { url: "/images/dress_poster.webp", fileId: null }, path: "/collections?category=dress" },
    { id: "denim", title: "Denim Wears", poster: { url: "/images/denim_poster.webp", fileId: null }, path: "/collections?category=denim" },
    { id: "shirt", title: "Shirts", poster: { url: "/images/shirt_poster.webp", fileId: null }, path: "/collections?category=shirt" },
  ],
  collectionBanner: {
    desktopImage: { url: "/bg/collection.webp", fileId: null },
    mobileImage: { url: "/bg/collection_mobile.webp", fileId: null },
    ctaLabel: "SHOP NOW",
  },
  philosophy: {
    eyebrow: "featuring",
    heading: "THE DIVARA CRAFTSMANSHIP",
    paragraphs: [
      "Every creation is more than a product—it is a statement of artistry, detail, and timeless design. Reflects passion, craftsmanship, and elegance, turning simple ideas into luxury.",
      "From pure handwoven silks to modern silhouettes, every piece is finished with quiet precision and enduring quality.",
    ],
    video: { url: "/videos/models.mp4", fileId: null },
    ctaLabel: "READ OUR STORY",
  },
  luxuryPillars: [
    {
      heading: "The Luxury of Experience",
      paragraph: "Luxury is more than what you wear—it’s the experience you live. Every detail, from our designs to our packaging, is created to immerse you in a world of exclusivity.",
      image: { url: "/images/divara_bag.webp", fileId: null },
    },
    {
      heading: "Crafted to Your Perfection",
      paragraph: "Luxury is personal, every design begins with you. From precise measurements to the finest fabric selection, our creations are tailored to embrace individuality.",
      video: { url: "/videos/customizations.mp4", fileId: null },
    },
    {
      heading: "Elegance in Every Thread",
      paragraph: "Craftsmanship begins with precision and finishes with perfection. Every fabric, every stitch, and every detail is carefully curated to embody sophistication.",
      image: { url: "/images/branding_cloth.webp", fileId: null },
    },
    {
      heading: "Draped in Timeless Grace",
      paragraph: "A Divara creation is more than attire—it’s a masterpiece of elegance that transcends seasons. Our designs celebrate the harmony of form, fabric, and finesse.",
      image: { url: "/images/satin_closet.webp", fileId: null },
    },
  ],
  contact: {
    bannerImage: { url: "/bg/contact_bg.webp", fileId: null },
    email: "support@divara.byfalguni.com",
    phone: "+91 (033) 2284-9100",
    supportHours: "Monday – Saturday, 10:00 AM to 8:00 PM IST",
    locations: ["Kolkata", "Mumbai", "New Delhi"],
    faqs: [
      {
        question: "How long does shipping take within India?",
        answer: "Standard orders are dispatched within 2 to 4 business days and delivered within 5 to 7 business days across India with complimentary insured shipping.",
      },
      {
        question: "What is your return and exchange policy?",
        answer: "We accept returns and size exchanges within 7 days of delivery for unworn items in original condition with all tags and packaging intact.",
      },
      {
        question: "How should I care for silk and handwoven garments?",
        answer: "We recommend professional dry cleaning only for our silk sarees, Chanderi pieces, and velvet garments. Store them in the breathable cotton bag provided with your order.",
      },
      {
        question: "Can I track my order after checkout?",
        answer: "Yes. Once your order is dispatched, you will receive an email with your tracking link and estimated delivery date, and you can view status anytime in your DIVARA account.",
      },
    ],
  },
};

const SEED_POLICIES = [
  {
    slug: "privacy-policy",
    title: "Privacy Policy",
    summary:
      "How DIVARA collects, processes, stores, and protects your personal information under India's Digital Personal Data Protection (DPDP) Act and international privacy standards.",
    effectiveDate: "November 2026",
    sections: [
      {
        heading: "1. Scope & Commitment to Privacy",
        body: "DIVARA ('we', 'our', 'us') is committed to protecting the confidentiality and security of every client who visits divara.byfalguni.com or purchases from our ateliers in Kolkata, Mumbai, and New Delhi. This Privacy Policy explains what information we collect, why we collect it, how long we retain it, and the rights you hold over your personal data.",
      },
      {
        heading: "2. Information We Collect",
        body: "When you register an account (via email and password or Google Sign-In), place an order, subscribe to seasonal dispatches, or contact client support, we collect: (a) Identity & Contact Data such as your full name, email address, and phone number; (b) Delivery & Billing Data including your shipping address, PIN code, and GST invoice details; (c) Order & Bag History stored securely in your authenticated account; and (d) User-Generated Content including product ratings, written reviews, and up to three optional photographs you choose to upload.",
      },
      {
        heading: "3. Payment Processing & Financial Security",
        body: "All online payments in Indian Rupees (INR) are processed through Razorpay, a PCI-DSS Level 1 compliant payment gateway. DIVARA never receives, inspects, or stores your raw credit/debit card numbers, CVV codes, UPI PINs, or net-banking passwords on our servers. We store only transaction reference IDs and payment statuses for accounting, invoicing, and refund reconciliation.",
      },
      {
        heading: "4. Strictly Necessary Session Cookies",
        body: "We use strictly necessary, encrypted HttpOnly cookies (divara_at and divara_rt) solely to maintain your authenticated session, protect your shopping bag, and prevent unauthorized cross-site request forgery. We do not sell your personal information to third-party ad brokers or run invasive cross-site behavioral tracking.",
      },
      {
        heading: "5. Media Storage & Review Photographs",
        body: "Photographs uploaded with product reviews are transmitted securely to our media delivery partner (ImageKit) over HTTPS. If you delete your review from a product page or request account deletion, we permanently delete the associated review photographs from ImageKit storage as well.",
      },
      {
        heading: "6. Data Retention & Automated Purging",
        body: "Session refresh tokens expire automatically within 30 days and are purged from MongoDB via native Time-To-Live (TTL) indexes. Order and GST tax records are retained for up to 7 years strictly as required by Indian statutory tax regulations. Support tickets and newsletter subscriptions are retained until resolved or unsubscribed.",
      },
      {
        heading: "7. Your Rights & Grievance Redressal",
        body: "Under India's DPDP Act, you have the right to access, correct, update, or request erasure of your personal data, and to withdraw consent for marketing dispatches at any time. To exercise these rights or contact our Grievance Officer, email support@divara.byfalguni.com or call +91 (033) 2284-9100 (Monday to Saturday, 10:00 AM – 8:00 PM IST).",
      },
    ],
  },
  {
    slug: "shipping-returns",
    title: "Shipping & Returns Policy",
    summary:
      "Complimentary insured pan-India courier delivery, handloom quality inspection timelines, and our 7-day return and size exchange guarantee.",
    effectiveDate: "November 2026",
    sections: [
      {
        heading: "1. Complimentary Insured Pan-India Shipping",
        body: "Every DIVARA garment—whether a handwoven Kanjivaram saree, Banarasi katan weave, Chanderi dress, or raw selvedge denim piece—is shipped with complimentary full-value transit insurance across India. There are no hidden shipping charges at checkout.",
      },
      {
        heading: "2. Atelier Quality Inspection & Dispatch Timelines",
        body: "Each order undergoes a final weave, seam, and steam-finish inspection at our Kolkata atelier before dispatch. Ready-to-ship garments are dispatched within 2 to 4 business days. Standard delivery takes 5 to 7 business days to metropolitan cities (Kolkata, Mumbai, New Delhi, Bengaluru, Chennai, Hyderabad) and 7 to 10 business days to remote PIN codes.",
      },
      {
        heading: "3. Luxury Packaging & Transit Protection",
        body: "All silk, Chanderi, and velvet creations are folded in acid-free tissue and packed inside a breathable pure cotton DIVARA storage bag, placed within a tamper-evident outer box. If the outer tamper seal appears broken upon delivery, please decline the parcel and notify support@divara.byfalguni.com immediately.",
      },
      {
        heading: "4. 7-Day Returns & Size Exchanges",
        body: "We accept returns and size exchanges within 7 calendar days of delivery. To qualify, garments must be completely unworn, unwashed, unaltered, free of perfume or makeup marks, and returned with all original DIVARA hangtags, zari authenticity cards, unstitched blouse pieces (for sarees), and the cotton storage bag intact.",
      },
      {
        heading: "5. Non-Returnable Items & Exceptions",
        body: "Items marked as Final Sale, custom-altered garments, or pieces showing signs of wear or missing original tags cannot be accepted for return. In the rare event of a manufacturing or transit defect, please share photographs within 48 hours of delivery for a priority replacement or full refund.",
      },
      {
        heading: "6. Refund Processing & Timelines",
        body: "Once your returned parcel reaches our atelier and clears quality verification (within 2 business days of receipt), refunds are initiated directly to your original Razorpay payment source (UPI, card, or bank account). Depending on your bank, funds reflect within 5 to 7 business days.",
      },
    ],
  },
  {
    slug: "terms-of-service",
    title: "Terms of Service",
    summary:
      "Terms governing account registration, INR pricing, 15-minute inventory locks, promotional coupons, user reviews, and intellectual property on divara.byfalguni.com.",
    effectiveDate: "November 2026",
    sections: [
      {
        heading: "1. Acceptance of Terms & Account Eligibility",
        body: "By accessing divara.byfalguni.com, creating an account, or placing an order, you agree to be bound by these Terms of Service. Shopping bag persistence, checkout, and product review submissions require an authenticated DIVARA account. You are responsible for maintaining the confidentiality of your login credentials.",
      },
      {
        heading: "2. Pricing, Currency & GST Compliance",
        body: "All garment prices on DIVARA are listed in Indian Rupees (INR). Applicable Goods and Services Tax (GST at 12% for luxury apparel above ₹1,000) is itemized transparently at checkout and included on your official tax invoice. We reserve the right to update prices prior to order confirmation.",
      },
      {
        heading: "3. Small-Batch Handloom Stock & 15-Minute Checkout Locks",
        body: "Many DIVARA garments are woven in strictly limited artisan batches. Placing an item in your Shopping Bag does not reserve stock. When you initiate Checkout, your selected size is reserved exclusively for 15 minutes while you complete payment via Razorpay. Unpaid reservations expire automatically after 15 minutes and return to the public catalog.",
      },
      {
        heading: "4. Promotional Coupons & Discounts",
        body: "Manual and auto-applied promotional coupons are subject to their configured start/end dates, minimum order subtotals, eligible product/category scopes, and per-user or global usage limits. Unless explicitly stated otherwise, only one promotional code may be applied per order, and coupons have no cash redemption value.",
      },
      {
        heading: "5. User Reviews & Uploaded Photographs",
        body: "Authenticated members may submit one review and up to three original photographs per garment. By uploading review images, you grant DIVARA a non-exclusive license to display them on the product page. Reviews containing spam, profanity, misleading claims, or third-party copyrighted imagery may be removed by our moderation team.",
      },
      {
        heading: "6. Intellectual Property & Handloom Craftsmanship",
        body: "All editorial photography, typography, brand marks, garment silhouettes, and lookbook videos on divara.byfalguni.com are the exclusive intellectual property of DIVARA. Subtle variations in handwoven zari, silk slubs, or natural indigo dyeing are inherent signatures of authentic Indian handloom craft and are not considered defects.",
      },
      {
        heading: "7. Governing Law & Jurisdiction",
        body: "These Terms of Service and any disputes arising from purchases on divara.byfalguni.com are governed by the laws of India, with exclusive jurisdiction vested in the courts of Kolkata, West Bengal.",
      },
    ],
  },
];

async function seed() {
  await connectDatabase();

  for (const prod of SEED_PRODUCTS) {
    await Product.findOneAndUpdate(
      { slug: prod.slug },
      { $set: { ...prod, pricePaise: Math.round(prod.price * 100) } },
      { upsert: true, returnDocument: "after" }
    );
  }
  console.log(`[Seed] Upserted ${SEED_PRODUCTS.length} DIVARA products.`);

  await SiteContent.findOneAndUpdate(
    { key: "global" },
    { $set: SEED_SITE_CONTENT },
    { upsert: true, returnDocument: "after" }
  );
  console.log("[Seed] Upserted global CMS SiteContent.");

  for (const policy of SEED_POLICIES) {
    await PolicyPage.findOneAndUpdate(
      { slug: policy.slug },
      { $set: policy },
      { upsert: true, returnDocument: "after" }
    );
  }
  console.log(`[Seed] Upserted ${SEED_POLICIES.length} detailed legal PolicyPages.`);

  const superAdminEmail = "admin@divara.com";
  const existingSuperAdmin = await User.findOne({ email: superAdminEmail });
  if (!existingSuperAdmin) {
    const admin = new User({
      email: superAdminEmail,
      notificationEmail: "byfalguni@gmail.com",
      fullName: "DIVARA Super Admin",
      role: "super_admin",
      authProvider: "local",
    });
    await admin.setPassword("SuperAdmin@2026!");
    await admin.save();
    console.log(`[Seed] Created Super Admin: ${superAdminEmail} (OTP inbox: byfalguni@gmail.com).`);
  }

  await disconnectDatabase();
}

seed().catch((err) => {
  console.error("[Seed] Error:", err);
  process.exit(1);
});