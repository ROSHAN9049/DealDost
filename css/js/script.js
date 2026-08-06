const API_BASE = 'https://your-backend.onrender.com/api'; // Baad mein change karna

async function loadProducts() {
    const grid = document.getElementById('product-grid');
    if (!grid) return;
    grid.innerHTML = '⏳ Loading...';
    try {
        const res = await fetch(`${API_BASE}/products?keyword=top&category=default`);
        const products = await res.json();
        renderProducts(products);
    } catch {
        grid.innerHTML = '❌ Error loading products.';
    }
}

function renderProducts(products) {
    const grid = document.getElementById('product-grid');
    if (!products || products.length === 0) {
        grid.innerHTML = '<p>No products found.</p>';
        return;
    }
    grid.innerHTML = products.map(p => `
        <div class="product-card">
            <img src="${p.image_url || 'https://via.placeholder.com/300x200'}" alt="${p.name}">
            <div class="info">
                <h3>${p.name}</h3>
                <div class="price">₹${p.price || 'N/A'}</div>
                ${p.ai_review ? `<div class="ai-review">🤖 ${p.ai_review}</div>` : ''}
                <a href="/go/${p.id}" class="review-btn">📝 Read Review</a>
            </div>
        </div>
    `).join('');
}

async function loadCategory(category) {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    const grid = document.getElementById('product-grid');
    grid.innerHTML = '⏳ Loading...';
    try {
        const res = await fetch(`${API_BASE}/products?keyword=top&category=${category}`);
        const products = await res.json();
        renderProducts(products);
    } catch {
        grid.innerHTML = '❌ Error';
    }
}
window.loadCategory = loadCategory;
document.addEventListener('DOMContentLoaded', loadProducts);
