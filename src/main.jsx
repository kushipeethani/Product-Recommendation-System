import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { products } from "./products.js";
import "./styles.css";

function formatPrice(price) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(price);
}

function ProductCard({ product, highlighted, reason }) {
  return (
    <article className={`product-card ${highlighted ? "recommended" : ""}`}>
      <div>
        <div className="card-topline">
          <span className="category">{product.category}</span>
          {highlighted && <span className="match-label">AI pick</span>}
        </div>
        <h3>{product.name}</h3>
        <p>{product.description}</p>
        {reason && <p className="pick-reason">{reason}</p>}
      </div>
      <div className="product-meta">
        <span>{formatPrice(product.price)}</span>
        <span>{product.rating.toFixed(1)} / 5</span>
      </div>
      <div className="tags">
        {product.tags.map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>
    </article>
  );
}

function App() {
  const [preference, setPreference] = useState("I want a phone under $500 with good battery life");
  const [recommendations, setRecommendations] = useState([]);
  const [summary, setSummary] = useState("");
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const recommendedIds = useMemo(
    () => new Set(recommendations.map((item) => item.id)),
    [recommendations],
  );
  const recommendationById = useMemo(
    () => new Map(recommendations.map((item) => [item.id, item])),
    [recommendations],
  );
  const displayedProducts = useMemo(() => {
    if (recommendations.length === 0) {
      return products;
    }

    const recommendedProducts = recommendations
      .map((recommendation) => products.find((product) => product.id === recommendation.id))
      .filter(Boolean);
    const remainingProducts = products.filter((product) => !recommendedIds.has(product.id));

    return [...recommendedProducts, ...remainingProducts];
  }, [recommendations, recommendedIds]);

  async function handleSubmit(event) {
    event.preventDefault();
    const trimmedPreference = preference.trim();

    if (!trimmedPreference) {
      setError("Tell the assistant what you are looking for.");
      return;
    }

    setLoading(true);
    setError("");
    setSummary("");
    setSource("");
    setRecommendations([]);

    try {
      const response = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preference: trimmedPreference }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Recommendation request failed.");
      }

      setSummary(payload.summary);
      setSource(payload.source);
      setRecommendations(payload.recommendations);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="intro">
        <div>
          <p className="eyebrow">React + Groq API</p>
          <h1>AI Product Recommendation System</h1>
          <p>
            Browse the catalog, describe what you need, and get product matches selected from
            the list below.
          </p>
        </div>
      </section>

      <section className="workspace">
        <form className="request-panel" onSubmit={handleSubmit}>
          <label htmlFor="preference">Your preference</label>
          <textarea
            id="preference"
            value={preference}
            onChange={(event) => setPreference(event.target.value)}
            placeholder="Example: I want a lightweight laptop under $900 for college"
            rows={4}
          />
          <button type="submit" disabled={loading}>
            {loading ? "Finding matches..." : "Recommend products"}
          </button>
          {error && <p className="error">{error}</p>}
        </form>
      </section>

      <section className="catalog">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Available products</p>
            <h2>{recommendations.length > 0 ? "AI Picks First" : "Catalog"}</h2>
          </div>
          <div className="result-meta">
            {source && (
              <span className={`source-label ${source === "groq" ? "groq" : "local"}`}>
                {source === "groq" ? "Groq powered" : "Local fallback"}
              </span>
            )}
            {summary && <p className="summary">{summary}</p>}
          </div>
        </div>
        <div className="product-grid">
          {displayedProducts.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              highlighted={recommendedIds.has(product.id)}
              reason={recommendationById.get(product.id)?.reason}
            />
          ))}
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
