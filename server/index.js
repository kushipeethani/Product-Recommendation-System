import dotenv from "dotenv";
import express from "express";
import { fileURLToPath } from "url";
import path from "path";
import { products } from "../src/products.js";

dotenv.config();
dotenv.config({ path: "src/.env", override: false });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3001;
const groqModel = process.env.GROQ_MODEL || "llama-3.1-8b-instant";

app.use(express.json());

// Serve built frontend in production
const distPath = path.join(__dirname, "..", "dist");
app.use(express.static(distPath));

// ========================
// SYNONYM MAP — Fuzzy Match
// ========================
const SYNONYM_MAP = {
  mobile: "phone",
  mobiles: "phone",
  smartphone: "phone",
  smartphones: "phone",
  cellphone: "phone",
  cellphones: "phone",
  cell: "phone",
  handset: "phone",
  handsets: "phone",
  tv: "monitor",
  tvs: "monitor",
  television: "monitor",
  televisions: "monitor",
  earphones: "earbuds",
  earphone: "earbuds",
  earbud: "earbuds",
  headphone: "headphones",
  sneakers: "shoes",
  shoes: "sneakers",
  notebook: "laptop",
  notebooks: "laptop",
  laptops: "laptop",
  pc: "laptop",
  computer: "laptop",
  computers: "laptop",
  smartwatch: "smartwatch",
  watch: "smartwatch",
  watches: "smartwatch",
  wearable: "smartwatch",
  wearables: "smartwatch",
  pad: "tablet",
  tablets: "tablet",
  speakers: "speaker",
  router: "networking",
  routers: "networking",
  wifi: "networking",
  gamepad: "gaming",
  console: "gaming",
  consoles: "gaming",
  webcam: "camera",
  cameras: "camera",
  charger: "accessory",
  chargers: "accessory",
  adapter: "accessory",
  adapters: "accessory",
  dock: "accessory",
  docks: "accessory",
  accessories: "accessory",
  mice: "mouse",
  keyboards: "keyboard",
  kb: "keyboard",
  monitors: "monitor",
  phones: "phone",
};

// ========================
// LEVENSHTEIN DISTANCE
// ========================
function levenshtein(a, b) {
  const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      matrix[i][j] =
        a[i - 1] === b[j - 1]
          ? matrix[i - 1][j - 1]
          : 1 + Math.min(matrix[i - 1][j], matrix[i][j - 1], matrix[i - 1][j - 1]);
    }
  }
  return matrix[a.length][b.length];
}

function fuzzyMatch(input, target, threshold = 2) {
  const a = input.toLowerCase();
  const t = target.toLowerCase();
  if (t.includes(a) || a.includes(t)) return true;
  return levenshtein(a, t) <= threshold;
}

// ========================
// QUERY PARSER
// ========================
function parseQuery(preference) {
  const raw = preference.toLowerCase().trim();
  const result = {
    category: null,
    brand: null,
    priceMin: null,
    priceMax: null,
    ratingMin: null,
    ratingMax: null,
    sortBy: null,
    userIntent: null,
    tags: [],
    features: [],
    colors: [],
    includeOutOfStock: false,
    rawQuery: preference,
  };

  // --- Out of stock ---
  if (/out\s*of\s*stock|unavailable|sold\s*out/i.test(raw)) {
    result.includeOutOfStock = true;
  }

  // --- Synonym expansion ---
  let expanded = raw;
  for (const [synonym, canonical] of Object.entries(SYNONYM_MAP)) {
    const regex = new RegExp(`\\b${synonym}\\b`, "gi");
    if (regex.test(expanded)) {
      expanded = expanded.replace(regex, canonical);
    }
  }

  // --- Category detection ---
  const allCategories = [...new Set(products.map((p) => p.category.toLowerCase()))];
  for (const cat of allCategories) {
    if (expanded.includes(cat)) {
      result.category = cat;
      break;
    }
  }
  // Fallback: fuzzy match categories
  if (!result.category) {
    const words = expanded.match(/[a-z0-9]+/g) || [];
    for (const word of words) {
      for (const cat of allCategories) {
        if (fuzzyMatch(word, cat, 2)) {
          result.category = cat;
          break;
        }
      }
      if (result.category) break;
    }
  }

  // --- Brand detection ---
  const allBrands = [...new Set(products.map((p) => p.brand.toLowerCase()))];
  for (const brand of allBrands) {
    if (expanded.includes(brand)) {
      result.brand = brand;
      break;
    }
  }
  if (!result.brand) {
    const words = expanded.match(/[a-z0-9]+/g) || [];
    for (const word of words) {
      for (const brand of allBrands) {
        if (fuzzyMatch(word, brand, 2)) {
          result.brand = brand;
          break;
        }
      }
      if (result.brand) break;
    }
  }

  // --- Rating filter (parse BEFORE price to avoid collisions) ---
  // Flexible: allows words between "rating" and "between/from" (e.g. "rating mobiles between 4.0-4.5")
  const ratingRange = raw.match(/rating\w*\s+.*?(?:between|from)\s*([\d.]+)\s*(?:to|-|and)\s*([\d.]+)/i)
    || raw.match(/rating\w*\s*(?:between|from)\s*([\d.]+)\s*(?:to|-|and)\s*([\d.]+)/i);
  const ratingAbove = raw.match(/rating\w*\s*(?:above|over|greater than|higher than|at least|>=?)\s*([\d.]+)/i);
  const ratingBelow = raw.match(/rating\w*\s*(?:below|under|less than|lower than|<=?)\s*([\d.]+)/i);
  const ratingStars = raw.match(/([\d.]+)\s*(?:stars?|\/5)/i);

  // Track whether the "between X and Y" was consumed as a rating
  let ratingConsumedRange = false;

  if (ratingRange) {
    result.ratingMin = parseFloat(ratingRange[1]);
    result.ratingMax = parseFloat(ratingRange[2]);
    ratingConsumedRange = true;
  } else if (ratingAbove) {
    result.ratingMin = parseFloat(ratingAbove[1]);
  } else if (ratingBelow) {
    result.ratingMax = parseFloat(ratingBelow[1]);
  } else if (ratingStars) {
    result.ratingMin = parseFloat(ratingStars[1]);
  }

  // --- Price range ---
  const rangeMatch = raw.match(/(?:between|from)\s*\$?([\d,.]+)\s*(?:to|-|and)\s*\$?([\d,.]+)/i);
  const aroundMatch = raw.match(/(?:around|about|approximately|~)\s*\$?([\d,.]+)/i);
  const maxMatch = raw.match(/(?:under|below|less than|max|maximum|up to|cheaper than)\s*\$?([\d,.]+)/i);
  const minMatch = raw.match(/(?:over|above|more than|at least|min|minimum|starting at)\s*\$?([\d,.]+)/i);

  if (rangeMatch && !ratingConsumedRange) {
    const a = parseFloat(rangeMatch[1].replace(/,/g, ""));
    const b = parseFloat(rangeMatch[2].replace(/,/g, ""));
    // If both values are ≤ 5 and "rating" appears in the query, treat as rating not price
    if (a <= 5 && b <= 5 && /rating/i.test(raw)) {
      if (!ratingRange) {
        result.ratingMin = Math.min(a, b);
        result.ratingMax = Math.max(a, b);
      }
    } else {
      result.priceMin = Math.min(a, b);
      result.priceMax = Math.max(a, b);
    }
  } else if (aroundMatch) {
    const target = parseFloat(aroundMatch[1].replace(/,/g, ""));
    result.priceMin = target * 0.8;
    result.priceMax = target * 1.2;
  } else if (!ratingConsumedRange) {
    if (maxMatch) result.priceMax = parseFloat(maxMatch[1].replace(/,/g, ""));
    if (minMatch) result.priceMin = parseFloat(minMatch[1].replace(/,/g, ""));
  }

  // --- Sorting ---
  if (/cheapest|lowest price|price low|price.?asc/i.test(raw)) {
    result.sortBy = "price_low_to_high";
  } else if (/most expensive|highest price|price high|price.?desc/i.test(raw)) {
    result.sortBy = "price_high_to_low";
  } else if (/top\s*rated|best\s*rated?|highest\s*rated?|rating\s*high|rating.?desc/i.test(raw)) {
    result.sortBy = "rating_high_to_low";
  } else if (/low(?:est)?\s*rated?|worst\s*rated?|rating\s*low|rating.?asc/i.test(raw)) {
    result.sortBy = "rating_low_to_high";
  } else if (/popular|trending|most\s*(?:bought|sold|viewed)/i.test(raw)) {
    result.sortBy = "popularity";
  } else if (/new(?:est)?|latest|recent/i.test(raw)) {
    result.sortBy = "newest";
  } else if (/(?:biggest|best|highest|most)\s*discount/i.test(raw)) {
    result.sortBy = "discount_high_to_low";
  }

  // --- User intent ---
  if (/\bbest\b/i.test(raw)) {
    result.userIntent = "best";
  } else if (/\btop\b/i.test(raw)) {
    result.userIntent = "top";
  } else if (/\bbudget\b|cheap(?:est)?|\baffordable\b|\blow.?cost\b/i.test(raw)) {
    result.userIntent = "budget";
  } else if (/\bpremium\b|\bluxury\b|\bhigh.?end\b|\bflagship\b/i.test(raw)) {
    result.userIntent = "premium";
  } else if (/\btrending\b|\bhot\b|\bpopular\b/i.test(raw)) {
    result.userIntent = "trending";
  } else if (/most\s*review/i.test(raw)) {
    result.userIntent = "most_reviewed";
  } else if (/value\s*(?:for)?\s*money|\bbang\s*for\s*(?:the)?\s*buck/i.test(raw)) {
    result.userIntent = "value_for_money";
  }

  // --- Tag / feature extraction ---
  const allTags = [...new Set(products.flatMap((p) => p.tags))];
  const allFeatures = [...new Set(products.flatMap((p) => p.features))];
  const allColors = [...new Set(products.flatMap((p) => p.color.map((c) => c.toLowerCase())))];

  // Words that represent user intent, not product tag filters
  const intentWords = new Set([
    "best", "top", "budget", "cheap", "cheapest", "affordable",
    "premium", "luxury", "flagship", "high-end",
    "trending", "hot", "popular",
    "value", "money", "bang", "buck",
    "most", "reviewed", "newest", "latest", "recent",
  ]);

  for (const tag of allTags) {
    if (intentWords.has(tag)) continue;
    if (expanded.includes(tag)) result.tags.push(tag);
  }
  for (const feat of allFeatures) {
    if (expanded.includes(feat)) result.features.push(feat);
  }
  for (const color of allColors) {
    if (expanded.includes(color)) result.colors.push(color);
  }

  return result;
}

// ========================
// FILTER ENGINE
// ========================
function filterProducts(productList, query) {
  return productList.filter((p) => {
    // Out of stock exclusion
    if (!query.includeOutOfStock && p.availability === "out_of_stock") return false;

    // Category
    if (query.category && p.category.toLowerCase() !== query.category) return false;

    // Brand
    if (query.brand && p.brand.toLowerCase() !== query.brand) return false;

    // Price range
    if (query.priceMin !== null && p.price < query.priceMin) return false;
    if (query.priceMax !== null && p.price > query.priceMax) return false;

    // Rating range
    if (query.ratingMin !== null && p.rating < query.ratingMin) return false;
    if (query.ratingMax !== null && p.rating > query.ratingMax) return false;

    // Color
    if (query.colors.length > 0) {
      const productColors = p.color.map((c) => c.toLowerCase());
      const hasColor = query.colors.some((c) => productColors.some((pc) => pc.includes(c)));
      if (!hasColor) return false;
    }

    // Tags
    if (query.tags.length > 0) {
      const hasTag = query.tags.some((t) => p.tags.includes(t));
      if (!hasTag) return false;
    }

    // Features
    if (query.features.length > 0) {
      const hasFeat = query.features.some((f) => p.features.includes(f));
      if (!hasFeat) return false;
    }

    return true;
  });
}

// ========================
// RANKING ENGINE
// ========================
function computeRelevanceScore(product, query) {
  const intent = query.userIntent;
  const sortBy = query.sortBy;

  // Normalize values for scoring
  const maxPrice = Math.max(...products.map((p) => p.price));
  const maxReviews = Math.max(...products.map((p) => p.reviews));
  const maxPopularity = 100;

  const normRating = product.rating / 5;
  const normReviews = product.reviews / maxReviews;
  const normPopularity = product.popularity / maxPopularity;
  const normPriceLow = 1 - product.price / maxPrice; // cheaper = higher score
  const normDiscount = product.discount / 100;

  // Text relevance from raw query
  const words = (query.rawQuery || "").toLowerCase().match(/[a-z0-9]+/g) || [];
  const searchableText = [
    product.name,
    product.brand,
    product.category,
    product.description,
    ...product.tags,
    ...product.features,
  ]
    .join(" ")
    .toLowerCase();
  const textScore = words.reduce((s, w) => s + (searchableText.includes(w) ? 0.05 : 0), 0);

  let score = textScore;

  switch (intent) {
    case "best":
      score += normRating * 0.4 + normReviews * 0.3 + normPopularity * 0.3;
      break;
    case "top":
      score += normPopularity * 0.5 + normRating * 0.5;
      break;
    case "budget":
      score += normPriceLow * 0.5 + normRating * 0.3 + normReviews * 0.2;
      break;
    case "premium":
      score += normRating * 0.4 + (1 - normPriceLow) * 0.3 + normReviews * 0.3;
      break;
    case "trending":
      score += normPopularity * 0.6 + normReviews * 0.2 + normRating * 0.2;
      break;
    case "most_reviewed":
      score += normReviews * 0.7 + normRating * 0.3;
      break;
    case "value_for_money":
      score += (product.rating / product.price) * 200 + normDiscount * 0.3;
      break;
    default:
      // General relevance
      score += normRating * 0.3 + normReviews * 0.2 + normPopularity * 0.2 + textScore;
      break;
  }

  return score;
}

function sortProducts(productList, sortBy) {
  const sorted = [...productList];

  switch (sortBy) {
    case "price_low_to_high":
      sorted.sort((a, b) => a.price - b.price);
      break;
    case "price_high_to_low":
      sorted.sort((a, b) => b.price - a.price);
      break;
    case "rating_high_to_low":
      sorted.sort((a, b) => {
        if (b.rating !== a.rating) return b.rating - a.rating;
        if (b.reviews !== a.reviews) return b.reviews - a.reviews;
        return a.price - b.price;
      });
      break;
    case "rating_low_to_high":
      sorted.sort((a, b) => {
        if (a.rating !== b.rating) return a.rating - b.rating;
        if (b.reviews !== a.reviews) return b.reviews - a.reviews;
        return a.price - b.price;
      });
      break;
    case "popularity":
      sorted.sort((a, b) => b.popularity - a.popularity);
      break;
    case "newest":
      sorted.sort((a, b) => new Date(b.addedDate) - new Date(a.addedDate));
      break;
    case "discount_high_to_low":
      sorted.sort((a, b) => b.discount - a.discount);
      break;
    default:
      break;
  }

  return sorted;
}

function rankProducts(productList, query) {
  const scored = productList.map((p) => ({
    product: p,
    score: computeRelevanceScore(p, query),
  }));

  // If there's an explicit sort, use it; otherwise sort by relevance
  if (query.sortBy) {
    const sorted = sortProducts(
      scored.map((s) => ({ ...s.product, _score: s.score })),
      query.sortBy
    );
    return sorted.map((p) => ({ product: p, score: p._score }));
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// ========================
// REASON GENERATOR
// ========================
function generateReason(product, query) {
  const parts = [];

  if (query.userIntent === "best") parts.push(`Top rated at ${product.rating}/5 with ${product.reviews.toLocaleString()} reviews`);
  else if (query.userIntent === "budget") parts.push(`Great value at $${product.price}`);
  else if (query.userIntent === "premium") parts.push(`Premium ${product.brand} with ${product.rating}/5 rating`);
  else if (query.userIntent === "trending") parts.push(`High popularity score (${product.popularity}/100)`);
  else if (query.userIntent === "most_reviewed") parts.push(`${product.reviews.toLocaleString()} reviews`);
  else if (query.userIntent === "value_for_money") parts.push(`Excellent rating-to-price ratio at $${product.price} with ${product.rating}/5`);
  else parts.push(`${product.rating}/5 rating with ${product.reviews.toLocaleString()} reviews`);

  if (product.discount > 0) parts.push(`${product.discount}% off`);
  if (query.category) parts.push(`in ${product.category}`);

  const matchedTags = query.tags.filter((t) => product.tags.includes(t));
  if (matchedTags.length > 0) parts.push(`matches: ${matchedTags.join(", ")}`);

  return parts.join(". ") + ".";
}

// ========================
// LOCAL RECOMMENDATION ENGINE
// ========================
function buildLocalRecommendations(preference, note) {
  const query = parseQuery(preference);
  let filtered = filterProducts(products, query);

  // If no exact matches, return closest alternatives
  let isAlternative = false;
  if (filtered.length === 0) {
    isAlternative = true;
    // Relax filters: try without brand
    const relaxedQuery = { ...query, brand: null };
    filtered = filterProducts(products, relaxedQuery);

    // Still nothing? Relax price but keep category, sort by price proximity
    if (filtered.length === 0) {
      const moreRelaxed = { ...relaxedQuery, priceMin: null, priceMax: null };
      filtered = filterProducts(products, moreRelaxed);

      // Sort by price proximity to the original budget
      const targetPrice = query.priceMax || query.priceMin || 0;
      if (targetPrice > 0) {
        filtered.sort((a, b) => Math.abs(a.price - targetPrice) - Math.abs(b.price - targetPrice));
      }
    }
  }

  const ranked = isAlternative && (query.priceMax || query.priceMin)
    ? filtered.map((p) => ({ product: p, score: 0 }))  // already sorted by price proximity
    : rankProducts(filtered, query);

  // Min 3, max 10
  const count = Math.max(3, Math.min(10, ranked.length));
  const topItems = ranked.slice(0, count);

  const priceRange =
    query.priceMin !== null && query.priceMax !== null
      ? `$${Math.round(query.priceMin)}-$${Math.round(query.priceMax)}`
      : query.priceMax !== null
        ? `under $${Math.round(query.priceMax)}`
        : query.priceMin !== null
          ? `above $${Math.round(query.priceMin)}`
          : "";

  const response = {
    query_understanding: {
      category: query.category || "",
      price_range: priceRange,
      rating_filter:
        query.ratingMin !== null && query.ratingMax !== null
          ? `${query.ratingMin}-${query.ratingMax}`
          : query.ratingMin !== null
            ? `above ${query.ratingMin}`
            : query.ratingMax !== null
              ? `below ${query.ratingMax}`
              : "",
      sort_by: query.sortBy || "",
      user_intent: query.userIntent || "",
    },
    recommendations: topItems.map(({ product, score }) => ({
      id: product.id,
      name: product.name,
      brand: product.brand,
      price: `$${product.price}`,
      rating: `${product.rating}/5`,
      reviews: product.reviews.toLocaleString(),
      discount: product.discount > 0 ? `${product.discount}%` : "0%",
      availability: product.availability,
      reason: isAlternative
        ? `No exact match in your price range. Closest to your budget at $${product.price} — ${product.rating}/5 rating.${product.discount > 0 ? ` ${product.discount}% off.` : ""}`
        : generateReason(product, query),
    })),
    summary: note || "Recommended using the local catalog matcher.",
    source: "local-fallback",
  };

  return response;
}

// ========================
// GROQ SYSTEM PROMPT
// ========================
const GROQ_SYSTEM_PROMPT = `You are a product recommendation assistant. You MUST follow these rules strictly:

CORE RULES:
- Recommend ONLY products from the provided catalog (match by exact "id" field).
- Return between 3 and 10 recommendations, sorted by relevance score.
- Never invent fake products.

FILTERING RULES:
- Apply category, brand, price range, rating range, availability, discount, tags, features, and color filters from the user's query.
- Exclude out-of-stock products (availability: "out_of_stock") unless user explicitly asks for them.

PRICE RULES:
- "under $X" = price <= X
- "above $X" = price >= X  
- "between $X and $Y" = X <= price <= Y
- "around $X" = price within 20% of X
- "cheap"/"budget" = lowest prices with decent rating
- "premium" = high price + high rating

RATING RULES:
- "top rated" / "best rating" = highest ratings first
- "low rated" / "worst rated" = lowest ratings first
- Equal ratings: higher reviews count wins, then lower price wins

SMART INTENT:
- "best" = prioritize ratings + reviews + popularity
- "top" = prioritize popularity + ratings  
- "budget" = low price + decent rating
- "premium" = quality + brand + rating
- "trending" = popularity + recent
- "most reviewed" = review count
- "value for money" = rating/price ratio

FUZZY MATCHING:
- mobile = smartphone = phone
- tv = television = monitor
- earbuds = earphones
- notebook = laptop

RESPONSE FORMAT (return ONLY this JSON, nothing else):
{
  "query_understanding": {
    "category": "",
    "price_range": "",
    "rating_filter": "",
    "sort_by": "",
    "user_intent": ""
  },
  "recommendations": [
    {
      "id": "exact product id from catalog",
      "reason": "one concise reason this product matches"
    }
  ],
  "summary": "one short sentence explaining the match strategy"
}

If no exact matches exist, return closest alternatives and explain why.`;

// ========================
// GROQ RESPONSE PARSER
// ========================
function parseGroqRecommendation(content) {
  const parsed = JSON.parse(content || "{}");

  if (!Array.isArray(parsed.recommendations)) {
    throw new Error("Groq returned JSON without a recommendations array.");
  }

  return {
    summary: typeof parsed.summary === "string" ? parsed.summary : "Recommended products from Groq.",
    query_understanding: parsed.query_understanding || {},
    recommendations: parsed.recommendations,
  };
}

// ========================
// API ENDPOINT
// ========================
app.post("/api/recommend", async (req, res) => {
  const preference = String(req.body?.preference || "").trim();

  if (!preference) {
    return res.status(400).json({ error: "Preference is required." });
  }

  // Always parse query for the structured response
  const query = parseQuery(preference);

  if (!process.env.GROQ_API_KEY) {
    return res.json(
      buildLocalRecommendations(
        preference,
        "Using local recommendations because GROQ_API_KEY is not configured.",
      ),
    );
  }

  try {
    // Pre-filter catalog to reduce tokens sent to Groq
    const filteredCatalog = filterProducts(products, query);
    const catalogForAI = (filteredCatalog.length > 0 ? filteredCatalog : products)
      .map((p) => `${p.id}|${p.name}|${p.category}|$${p.price}|${p.rating}★|${p.tags.slice(0, 3).join(",")}`);

    const sendToGroq = async () => {
      return fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: groqModel,
          messages: [
            {
              role: "system",
              content: GROQ_SYSTEM_PROMPT,
            },
            {
              role: "user",
              content: `Preference: ${preference}\nProducts (id|name|category|price|rating|tags):\n${catalogForAI.join("\n")}`,
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.2,
        }),
      });
    };

    let aiResponse = await sendToGroq();

    // Retry once after short delay on 429
    if (aiResponse.status === 429) {
      const retryAfter = parseFloat(aiResponse.headers.get("retry-after")) || 1;
      await new Promise((r) => setTimeout(r, retryAfter * 1000 + 200));
      aiResponse = await sendToGroq();
    }

    const payload = await aiResponse.json();

    if (!aiResponse.ok) {
      const groqError = payload.error?.message || "Groq recommendation request failed.";

      return res.json(
        buildLocalRecommendations(
          preference,
          `Groq API returned an error (${aiResponse.status}), so these recommendations were generated locally. Details: ${groqError}`,
        ),
      );
    }

    const result = parseGroqRecommendation(payload.choices?.[0]?.message?.content);
    const catalogById = new Map(products.map((p) => [p.id, p]));

    // Validate AI picks against catalog and re-apply local filters
    const eligibleProductIds = new Set(
      filterProducts(products, query).map((p) => p.id)
    );

    let validatedRecs = result.recommendations
      .filter((item) => catalogById.has(item.id))
      .filter((item) => eligibleProductIds.has(item.id))
      .map((item) => {
        const product = catalogById.get(item.id);
        return {
          id: product.id,
          name: product.name,
          brand: product.brand,
          price: `$${product.price}`,
          rating: `${product.rating}/5`,
          reviews: product.reviews.toLocaleString(),
          discount: product.discount > 0 ? `${product.discount}%` : "0%",
          availability: product.availability,
          reason: item.reason,
        };
      });

    // Exclude out-of-stock unless requested
    if (!query.includeOutOfStock) {
      validatedRecs = validatedRecs.filter((r) => r.availability !== "out_of_stock");
    }

    // Enforce min 3, max 10
    if (validatedRecs.length < 3) {
      // Backfill from local engine
      const localResult = buildLocalRecommendations(preference);
      const existingIds = new Set(validatedRecs.map((r) => r.id));
      const backfills = localResult.recommendations.filter((r) => !existingIds.has(r.id));
      validatedRecs = [...validatedRecs, ...backfills].slice(0, 10);
    } else {
      validatedRecs = validatedRecs.slice(0, 10);
    }

    // Build price_range string for query_understanding
    const priceRange =
      query.priceMin !== null && query.priceMax !== null
        ? `$${Math.round(query.priceMin)}-$${Math.round(query.priceMax)}`
        : query.priceMax !== null
          ? `under $${Math.round(query.priceMax)}`
          : query.priceMin !== null
            ? `above $${Math.round(query.priceMin)}`
            : "";

    const ratingFilter =
      query.ratingMin !== null && query.ratingMax !== null
        ? `${query.ratingMin}-${query.ratingMax}`
        : query.ratingMin !== null
          ? `above ${query.ratingMin}`
          : query.ratingMax !== null
            ? `below ${query.ratingMax}`
            : "";

    return res.json({
      query_understanding: {
        category: query.category || "",
        price_range: priceRange,
        rating_filter: ratingFilter,
        sort_by: query.sortBy || "",
        user_intent: query.userIntent || "",
      },
      recommendations: validatedRecs,
      summary:
        validatedRecs.length > 0
          ? result.summary
          : "No catalog products exactly match that price and category.",
      source: "groq",
    });
  } catch (error) {
    return res.json(
      buildLocalRecommendations(
        preference,
        `Groq response could not be used, so these recommendations were generated locally. Details: ${
          error.message || "Unexpected recommendation error."
        }`,
      ),
    );
  }
});

// SPA fallback — serve index.html for any non-API route
app.get("{*path}", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

app.listen(port, () => {
  console.log(`Recommendation API running on http://localhost:${port}`);
});
