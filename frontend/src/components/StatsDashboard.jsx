import React from 'react';
import './StatsDashboard.css';

export default function StatsDashboard({ stats, onClose }) {
  if (!stats) return null;

  const { min, max, mean, categories, histogram } = stats;

  // Vegetation coverage: sum of sparse, moderate, and dense percentages
  const vegCoverage = (categories.sparse?.pct || 0) + (categories.moderate?.pct || 0) + (categories.dense?.pct || 0);

  // Categories metadata for rendering
  const catList = [
    { key: 'dense', label: '🌳 Dense Vegetation', color: '#16803d', range: '0.5 to 1.0' },
    { key: 'moderate', label: '🌿 Moderate Vegetation', color: '#22c55e', range: '0.3 to 0.5' },
    { key: 'sparse', label: '🌱 Sparse Vegetation', color: '#a3e635', range: '0.15 to 0.3' },
    { key: 'barren', label: '🏜️ Barren Land / Soil', color: '#eab308', range: '0.0 to 0.15' },
    { key: 'water', label: '💧 Water bodies', color: '#3b82f6', range: '< 0.0' },
    { key: 'masked', label: '☁️ Clouds / Shadows / Masked', color: '#6b7280', range: 'N/A' },
  ];

  // SVG Histogram Dimensions
  const svgWidth = 360;
  const svgHeight = 140;
  const padding = 20;
  const chartWidth = svgWidth - padding * 2;
  const chartHeight = svgHeight - padding * 2;

  const bins = histogram?.bins || [];
  const maxBinValue = Math.max(...bins, 1);
  const numBins = bins.length;

  // Generate SVG path for the area chart
  const points = bins.map((val, idx) => {
    const x = padding + (idx / (numBins - 1)) * chartWidth;
    const y = padding + chartHeight - (val / maxBinValue) * chartHeight;
    return { x, y };
  });

  const pathD = points.length > 0 
    ? `M ${points[0].x} ${padding + chartHeight} ` + 
      points.map(p => `L ${p.x} ${p.y}`).join(' ') + 
      ` L ${points[points.length - 1].x} ${padding + chartHeight} Z`
    : '';

  const lineD = points.length > 0
    ? points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
    : '';

  return (
    <div className="stats-dashboard">
      <div className="dashboard-header">
        <div className="dashboard-title-group">
          <h2>📊 Vegetation Analysis</h2>
          <p>Analysis of current bounding box area</p>
        </div>
        <button className="btn-close" onClick={onClose} title="Close Panel">&times;</button>
      </div>

      <div className="divider" />

      {/* Metrics Row */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Mean NDVI</div>
          <div className="metric-value">{mean.toFixed(3)}</div>
          <div className="metric-sub">
            {mean >= 0.5 ? 'Dense Veg' : mean >= 0.3 ? 'Moderate Veg' : mean >= 0.15 ? 'Sparse Veg' : 'Low/No Veg'}
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Vegetation Cover</div>
          <div className="metric-value">{vegCoverage.toFixed(1)}%</div>
          <div className="metric-sub">NDVI &ge; 0.15</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Min / Max NDVI</div>
          <div className="metric-value">{min.toFixed(2)} / {max.toFixed(2)}</div>
          <div className="metric-sub">Valid Range</div>
        </div>
      </div>

      {/* Stacked Percentage bar */}
      <div className="stacked-bar-container">
        <h3>Vegetation Class Breakdown</h3>
        <div className="stacked-bar">
          {catList.map(cat => {
            const pct = categories[cat.key]?.pct || 0;
            if (pct <= 0) return null;
            return (
              <div 
                key={cat.key}
                className="stacked-bar-segment"
                style={{ width: `${pct}%`, backgroundColor: cat.color }}
                title={`${cat.label}: ${pct.toFixed(1)}%`}
              />
            );
          })}
        </div>
      </div>

      {/* Categories Breakdown List */}
      <div className="categories-list">
        {catList.map(cat => {
          const item = categories[cat.key];
          if (!item) return null;
          return (
            <div className="category-item" key={cat.key}>
              <div className="category-info">
                <span className="category-color-dot" style={{ backgroundColor: cat.color }} />
                <span className="category-label">{cat.label}</span>
                <span className="category-range">{cat.range}</span>
              </div>
              <div className="category-value">
                <strong>{item.pct.toFixed(1)}%</strong>
                <span className="pixel-count">({item.count.toLocaleString()} px)</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="divider" />

      {/* Histogram SVG Chart */}
      <div className="histogram-container">
        <h3>NDVI Frequency Distribution Curve</h3>
        <div className="svg-wrapper">
          <svg width="100%" height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`}>
            <defs>
              <linearGradient id="ndvi-area-gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22c55e" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#22c55e" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Grid Lines */}
            <line x1={padding} y1={padding} x2={padding + chartWidth} y2={padding} stroke="#374151" strokeDasharray="3 3" />
            <line x1={padding} y1={padding + chartHeight/2} x2={padding + chartWidth} y2={padding + chartHeight/2} stroke="#374151" strokeDasharray="3 3" />
            <line x1={padding} y1={padding + chartHeight} x2={padding + chartWidth} y2={padding + chartHeight} stroke="#4b5563" />

            {/* Area Path */}
            {pathD && <path d={pathD} fill="url(#ndvi-area-gradient)" />}
            
            {/* Line Path */}
            {lineD && <path d={lineD} fill="none" stroke="#22c55e" strokeWidth="2.5" />}

            {/* Axis Marks & Labels */}
            {/* -0.2 Mark */}
            <line x1={padding} y1={padding + chartHeight} x2={padding} y2={padding + chartHeight + 4} stroke="#9ca3af" />
            <text x={padding} y={padding + chartHeight + 15} fill="#9ca3af" fontSize="10" textAnchor="middle">-0.2</text>

            {/* 0.0 Mark */}
            {(() => {
              const x0 = padding + ((0.0 - (-0.2)) / (1.0 - (-0.2))) * chartWidth;
              return (
                <g key="0.0">
                  <line x1={x0} y1={padding} x2={x0} y2={padding + chartHeight} stroke="#4b5563" strokeDasharray="2 2" />
                  <line x1={x0} y1={padding + chartHeight} x2={x0} y2={padding + chartHeight + 4} stroke="#9ca3af" />
                  <text x={x0} y={padding + chartHeight + 15} fill="#9ca3af" fontSize="10" textAnchor="middle">0.0</text>
                </g>
              );
            })()}

            {/* 0.3 Mark */}
            {(() => {
              const x3 = padding + ((0.3 - (-0.2)) / (1.0 - (-0.2))) * chartWidth;
              return (
                <g key="0.3">
                  <line x1={x3} y1={padding + chartHeight} x2={x3} y2={padding + chartHeight + 4} stroke="#9ca3af" />
                  <text x={x3} y={padding + chartHeight + 15} fill="#9ca3af" fontSize="10" textAnchor="middle">0.3</text>
                </g>
              );
            })()}

            {/* 0.5 Mark */}
            {(() => {
              const x5 = padding + ((0.5 - (-0.2)) / (1.0 - (-0.2))) * chartWidth;
              return (
                <g key="0.5">
                  <line x1={x5} y1={padding + chartHeight} x2={x5} y2={padding + chartHeight + 4} stroke="#9ca3af" />
                  <text x={x5} y={padding + chartHeight + 15} fill="#9ca3af" fontSize="10" textAnchor="middle">0.5</text>
                </g>
              );
            })()}

            {/* 1.0 Mark */}
            <line x1={padding + chartWidth} y1={padding + chartHeight} x2={padding + chartWidth} y2={padding + chartHeight + 4} stroke="#9ca3af" />
            <text x={padding + chartWidth} y={padding + chartHeight + 15} fill="#9ca3af" fontSize="10" textAnchor="middle">1.0</text>
          </svg>
        </div>
      </div>
    </div>
  );
}
