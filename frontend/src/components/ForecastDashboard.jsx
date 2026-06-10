import React, { useState, useEffect, useRef } from 'react';
import { fetchHistoricalNDVI, predictNDVI } from '../api/forecast';
import { renderNDVIArrayToDataURL } from '../utils/ndviParser';
import './ForecastDashboard.css';

export default function ForecastDashboard({ bbox, onClose, parsedTiffData, setOverlayUrl }) {
  const [step, setStep] = useState(1); // 1: Fetch, 2: Train & Predict, 3: Results
  const [yearsBack, setYearsBack] = useState(3);
  const [monthsAhead, setMonthsAhead] = useState(6);
  
  // Loading and error states
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // Data states
  const [historyData, setHistoryData] = useState(null); // { dates: [], ndvi_values: [] }
  const [predictions, setPredictions] = useState(null); // [ { index, ndvi, status, date } ]
  const [trainingLoss, setTrainingLoss] = useState(null);
  
  // Training progress simulation
  const [progress, setProgress] = useState(0);

  // Animation and Overlay manipulation States
  const [selectedPredIndex, setSelectedPredIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const playIntervalRef = useRef(null);

  // Reset states if bbox or tab changes
  useEffect(() => {
    setStep(1);
    setHistoryData(null);
    setPredictions(null);
    setTrainingLoss(null);
    setError(null);
    setSelectedPredIndex(-1);
    setIsPlaying(false);
  }, [bbox]);

  // Restore base map overlay on unmount
  useEffect(() => {
    return () => {
      if (parsedTiffData && setOverlayUrl) {
        setOverlayUrl(parsedTiffData.visualOverlayUrl);
      }
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
      }
    };
  }, [parsedTiffData, setOverlayUrl]);

  // Adjust overlay on prediction step change
  useEffect(() => {
    if (!parsedTiffData || !setOverlayUrl) return;

    if (selectedPredIndex === -1) {
      setOverlayUrl(parsedTiffData.visualOverlayUrl);
      return;
    }

    if (!predictions || !predictions[selectedPredIndex]) return;

    // Shift original Float32Array values to match predicted mean
    const predictedNDVI = predictions[selectedPredIndex].ndvi;
    const baseMean = parsedTiffData.stats.mean;
    const diff = predictedNDVI - baseMean;

    const baseArray = parsedTiffData.ndviData;
    const shiftedArray = new Float32Array(baseArray.length);

    for (let i = 0; i < baseArray.length; i++) {
      const val = baseArray[i];
      if (isNaN(val)) {
        shiftedArray[i] = NaN;
      } else {
        shiftedArray[i] = Math.max(-1.0, Math.min(1.0, val + diff));
      }
    }

    const newOverlayUrl = renderNDVIArrayToDataURL(shiftedArray, parsedTiffData.width, parsedTiffData.height);
    setOverlayUrl(newOverlayUrl);
  }, [selectedPredIndex, predictions, parsedTiffData, setOverlayUrl]);

  // Timer loop for auto-play timeline animation
  useEffect(() => {
    if (isPlaying && predictions && predictions.length > 0) {
      playIntervalRef.current = setInterval(() => {
        setSelectedPredIndex((prev) => {
          if (prev >= predictions.length - 1) {
            return -1;
          }
          return prev + 1;
        });
      }, 1500);
    } else {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
      }
    }

    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
      }
    };
  }, [isPlaying, predictions]);

  // Phase 1: Fetch historical monthly NDVI values
  const handleFetchHistory = async () => {
    if (!bbox) {
      setError('Please select a bounding box area first.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchHistoricalNDVI({ bbox, yearsBack });
      if (!data.ndvi_values || data.ndvi_values.length < 6) {
        throw new Error(`Insufficient historical data found (${data.ndvi_values?.length || 0} points). NDVI forecasting requires at least 6 months of historical data. Try selecting a different area or increasing years back.`);
      }
      setHistoryData(data);
      setStep(2);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to fetch historical NDVI. Please check backend.');
    } finally {
      setLoading(false);
    }
  };

  // Phase 2: Train LSTM model and forecast
  const handleTrainAndPredict = async () => {
    if (!historyData || !historyData.ndvi_values) return;
    setLoading(true);
    setError(null);
    setProgress(5);

    // Simulate training progress bar for premium visual UX
    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 90) {
          clearInterval(progressInterval);
          return 90;
        }
        return prev + Math.floor(Math.random() * 15) + 5;
      });
    }, 200);

    try {
      const response = await predictNDVI({
        ndviHistory: historyData.ndvi_values,
        tempHistory: historyData.temperature_values,
        precipHistory: historyData.precipitation_values,
        soilHistory: historyData.soil_moisture_values,
        monthsAhead: monthsAhead
      });

      clearInterval(progressInterval);
      setProgress(100);

      // Generate future dates starting from the day after the last history date
      const lastHistoryDateStr = historyData.dates[historyData.dates.length - 1];
      const lastDate = new Date(lastHistoryDateStr);
      
      const enrichedPredictions = response.predictions.map((pred, idx) => {
        const nextDate = new Date(lastDate);
        nextDate.setMonth(nextDate.getMonth() + idx + 1);
        const yyyy = nextDate.getFullYear();
        const mm = String(nextDate.getMonth() + 1).padStart(2, '0');
        const dd = String(nextDate.getDate()).padStart(2, '0');
        return {
          ...pred,
          date: `${yyyy}-${mm}-${dd}`
        };
      });

      setPredictions(enrichedPredictions);
      setTrainingLoss(response.training_loss);
      
      // Short delay before showing results to make transition smooth
      setTimeout(() => {
        setStep(3);
        setLoading(false);
      }, 400);

    } catch (err) {
      clearInterval(progressInterval);
      console.error(err);
      setError(err.message || 'Model training failed.');
      setLoading(false);
    }
  };

  // SVG Chart Calculation
  const renderChart = () => {
    if (!historyData) return null;

    const lastHistoryDateStr = historyData.dates[historyData.dates.length - 1];
    const histValues = historyData.ndvi_values;
    const predValues = predictions ? predictions.map(p => p.ndvi) : [];
    const allValues = [...histValues, ...predValues];
    
    // Find min and max for scaling the y-axis
    const minVal = Math.min(...allValues, -0.2);
    const maxVal = Math.max(...allValues, 1.0);
    const valRange = maxVal - minVal;

    const svgWidth = 800;
    const svgHeight = 160;
    const paddingLeft = 40;
    const paddingRight = 20;
    const paddingTop = 15;
    const paddingBottom = 25;
    
    const chartWidth = svgWidth - paddingLeft - paddingRight;
    const chartHeight = svgHeight - paddingTop - paddingBottom;

    const totalPoints = histValues.length + predValues.length;

    // Helper to get X and Y coordinates
    const getCoords = (index, value) => {
      const x = paddingLeft + (index / (totalPoints - 1)) * chartWidth;
      // Invert Y axis for screen coordinates
      const y = paddingTop + chartHeight - ((value - minVal) / valRange) * chartHeight;
      return { x, y };
    };

    // Generate path for history (solid line)
    let historyPath = '';
    histValues.forEach((val, idx) => {
      const { x, y } = getCoords(idx, val);
      historyPath += `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)} `;
    });

    // Generate path for predictions (dashed line)
    let predPath = '';
    if (predValues.length > 0) {
      // Connect to the last history point
      const lastHistIdx = histValues.length - 1;
      const lastHistVal = histValues[lastHistIdx];
      const startPt = getCoords(lastHistIdx, lastHistVal);
      predPath = `M ${startPt.x.toFixed(1)} ${startPt.y.toFixed(1)} `;
      
      predValues.forEach((val, idx) => {
        const { x, y } = getCoords(lastHistIdx + 1 + idx, val);
        predPath += `L ${x.toFixed(1)} ${y.toFixed(1)} `;
      });
    }

    // Generate vertical divider line between history and prediction
    let dividerX = 0;
    if (histValues.length > 0) {
      const pt = getCoords(histValues.length - 1, histValues[histValues.length - 1]);
      dividerX = pt.x;
    }

    return (
      <div className="forecast-chart-wrapper">
        <svg width="100%" height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`} preserveAspectRatio="none">
          <defs>
            {/* Grid Line Gradients */}
            <linearGradient id="grid-fade" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="rgba(255,255,255,0.05)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0.01)" />
            </linearGradient>
          </defs>

          {/* Y-Axis Grid lines & Labels */}
          {[0.0, 0.2, 0.4, 0.6, 0.8].map((gridVal) => {
            const y = paddingTop + chartHeight - ((gridVal - minVal) / valRange) * chartHeight;
            if (y < paddingTop || y > paddingTop + chartHeight) return null;
            return (
              <g key={gridVal}>
                <line 
                  x1={paddingLeft} 
                  y1={y} 
                  x2={svgWidth - paddingRight} 
                  y2={y} 
                  stroke="rgba(255, 255, 255, 0.08)" 
                  strokeDasharray="4 4" 
                />
                <text 
                  x={paddingLeft - 8} 
                  y={y + 4} 
                  fill="#64748b" 
                  fontSize="9" 
                  textAnchor="end"
                  fontFamily="monospace"
                >
                  {gridVal.toFixed(1)}
                </text>
              </g>
            );
          })}

          {/* Historical Data Line */}
          {historyPath && (
            <path 
              d={historyPath} 
              fill="none" 
              stroke="var(--accent-green)" 
              strokeWidth="2.5" 
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Forecasted Data Line */}
          {predPath && (
            <path 
              d={predPath} 
              fill="none" 
              stroke="var(--accent-purple-hover)" 
              strokeWidth="2.5" 
              strokeDasharray="5 4" 
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Historical/Prediction boundary line */}
          {dividerX > 0 && (
            <g>
              <line 
                x1={dividerX} 
                y1={paddingTop - 5} 
                x2={dividerX} 
                y2={paddingTop + chartHeight + 5} 
                stroke="rgba(255, 255, 255, 0.2)" 
                strokeDasharray="2 2"
              />
              <text 
                x={dividerX + 5} 
                y={paddingTop + 5} 
                fill="#94a3b8" 
                fontSize="8" 
                fontWeight="bold"
                letterSpacing="0.05em"
              >
                FORECAST START
              </text>
            </g>
          )}

          {/* X-axis baseline */}
          <line 
            x1={paddingLeft} 
            y1={paddingTop + chartHeight} 
            x2={svgWidth - paddingRight} 
            y2={paddingTop + chartHeight} 
            stroke="rgba(255, 255, 255, 0.2)" 
          />

          {/* Start and end date labels */}
          <text 
            x={paddingLeft} 
            y={paddingTop + chartHeight + 16} 
            fill="#64748b" 
            fontSize="9"
          >
            {historyData.dates[0]}
          </text>

          {dividerX > 0 && (
            <text 
              x={dividerX} 
              y={paddingTop + chartHeight + 16} 
              fill="#94a3b8" 
              fontSize="9"
              textAnchor="middle"
            >
              {lastHistoryDateStr}
            </text>
          )}

          {predictions && predictions.length > 0 && (
            <text 
              x={svgWidth - paddingRight} 
              y={paddingTop + chartHeight + 16} 
              fill="var(--accent-purple-hover)" 
              fontSize="9"
              textAnchor="end"
            >
              {predictions[predictions.length - 1].date}
            </text>
          )}
        </svg>

        <div className="forecast-chart-legend">
          <div className="forecast-legend-item">
            <span className="forecast-legend-line solid" />
            <span>Historical NDVI ({historyData.dates.length} months)</span>
          </div>
          <div className="forecast-legend-item">
            <span className="forecast-legend-line dashed" />
            <span>LSTM Forecasted Trend ({monthsAhead} months ahead)</span>
          </div>
        </div>
      </div>
    );
  };

  const getStatusClass = (status) => {
    if (status.includes('Fresh')) return 'healthy';
    if (status.includes('Dry')) return 'moderate';
    return 'stressed';
  };

  return (
    <div className="forecast-dashboard">
      <div className="forecast-header">
        <div className="forecast-header-left">
          <span>🔮</span>
          <h2>NDVI Time-Series LSTM Forecasting</h2>
        </div>
        <button className="forecast-btn-close" onClick={onClose} title="Close Panel">&times;</button>
      </div>

      <div className="forecast-body">
        {/* Step Indicator */}
        <div className="forecast-steps">
          <div className={`forecast-step ${step === 1 ? 'active' : step > 1 ? 'completed' : ''}`}>
            <span className="step-num">1</span> Acquire Data
          </div>
          <div className="step-connector" />
          <div className={`forecast-step ${step === 2 ? 'active' : step > 2 ? 'completed' : ''}`}>
            <span className="step-num">2</span> LSTM Train & Predict
          </div>
          <div className="step-connector" />
          <div className={`forecast-step ${step === 3 ? 'active' : ''}`}>
            <span className="step-num">3</span> Results
          </div>
        </div>

        {/* Phase 1: Fetching Historical Data */}
        {step === 1 && (
          <div className="forecast-phase">
            <h3>📂 Step 1: Query Sentinel Hub Statistical Archives</h3>
            <p style={{ fontSize: '0.82rem', color: '#94a3b8', lineHeight: '1.4', margin: '0 0 16px 0' }}>
              In order to train a custom Long Short-Term Memory (LSTM) model, we must retrieve monthly NDVI average values over a historical timeline. The Statistical API performs cloud masks and computes spatial means.
            </p>
            
            <div className="forecast-input-row">
              <label htmlFor="years-back">Historical Timeline Depth:</label>
              <input 
                id="years-back"
                type="range" 
                min="1" 
                max="5" 
                value={yearsBack} 
                onChange={(e) => setYearsBack(parseInt(e.target.value))}
                disabled={loading}
              />
              <span className="range-value">{yearsBack} Years</span>
            </div>

            <button 
              className="forecast-btn forecast-btn-primary" 
              onClick={handleFetchHistory} 
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="forecast-spinner" />
                  <span>Fetching NDVI History...</span>
                </>
              ) : (
                'Retrieve NDVI History'
              )}
            </button>
          </div>
        )}

        {/* Phase 2: Training & Simulation */}
        {step === 2 && (
          <div className="forecast-phase">
            <h3>🧠 Step 2: Train Local Recurrent Neural Network</h3>
            <p style={{ fontSize: '0.82rem', color: '#94a3b8', lineHeight: '1.4', margin: '0 0 16px 0' }}>
              Acquired <strong>{historyData?.ndvi_values?.length} months</strong> of clean NDVI. Now set your prediction window depth and build/train the PyTorch LSTM.
            </p>

            <div className="forecast-input-row">
              <label htmlFor="months-ahead">Forecast Horizon:</label>
              <input 
                id="months-ahead"
                type="range" 
                min="3" 
                max="24" 
                value={monthsAhead} 
                onChange={(e) => setMonthsAhead(parseInt(e.target.value))}
                disabled={loading}
              />
              <span className="range-value">{monthsAhead} Months</span>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
              <button 
                className="forecast-btn forecast-btn-purple" 
                onClick={handleTrainAndPredict} 
                disabled={loading}
              >
                {loading ? 'Optimizing LSTM Model...' : 'Train Model & Predict'}
              </button>
              <button 
                className="forecast-btn" 
                style={{ background: 'rgba(255,255,255,0.05)', color: '#cbd5e1' }}
                onClick={() => setStep(1)} 
                disabled={loading}
              >
                Back
              </button>
            </div>

            {loading && (
              <div className="forecast-progress">
                <div className="forecast-progress-label">
                  <span>Optimizer Backpropagation (Adam)</span>
                  <span>{progress}%</span>
                </div>
                <div className="forecast-progress-bar">
                  <div className="forecast-progress-fill" style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Phase 3: Results Display */}
        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="forecast-chart-container">
              <h3>📈 NDVI Historical & Predicted Timeseries Curve</h3>
              {renderChart()}
            </div>

            {parsedTiffData && predictions && predictions.length > 0 && (
              <div className="forecast-timeline-controller" style={{
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--border-glass)',
                borderRadius: '8px',
                padding: '12px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h4 style={{ margin: 0, fontSize: '0.85rem', color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>🗺️</span> Interactive Prediction Map Overlay
                  </h4>
                  <button
                    onClick={() => setIsPlaying(!isPlaying)}
                    style={{
                      background: 'rgba(139, 92, 246, 0.15)',
                      border: '1px solid rgba(139, 92, 246, 0.3)',
                      color: 'var(--accent-purple-hover)',
                      borderRadius: '4px',
                      padding: '4px 10px',
                      fontSize: '11px',
                      cursor: 'pointer',
                      fontWeight: 'bold',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    {isPlaying ? '⏸️ Pause Animation' : '▶️ Play Timelapse'}
                  </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                  <input
                    type="range"
                    min="-1"
                    max={predictions.length - 1}
                    value={selectedPredIndex}
                    onChange={(e) => {
                      setSelectedPredIndex(parseInt(e.target.value));
                      setIsPlaying(false);
                    }}
                    style={{ flex: 1, accentColor: 'var(--accent-purple)', cursor: 'pointer' }}
                  />
                  <span style={{
                    fontSize: '11px',
                    fontFamily: 'monospace',
                    background: 'rgba(0,0,0,0.3)',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    border: '1px solid var(--border-glass)',
                    minWidth: '150px',
                    textAlign: 'center'
                  }}>
                    {selectedPredIndex === -1 ? (
                      <span style={{ color: 'var(--accent-green)' }}>Base Map (Acquisition)</span>
                    ) : (
                      <span>
                        <strong style={{ color: 'var(--accent-purple-hover)' }}>Month +{predictions[selectedPredIndex].index}</strong> ({predictions[selectedPredIndex].date.substring(0, 7)})
                      </span>
                    )}
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#64748b' }}>
                  <span>Base NDVI (Mean: {parsedTiffData.stats.mean.toFixed(3)})</span>
                  {selectedPredIndex !== -1 && (
                    <span>Predicted Mean: <strong style={{ color: 'var(--accent-purple-hover)' }}>{predictions[selectedPredIndex].ndvi.toFixed(3)}</strong> (Shift: {(predictions[selectedPredIndex].ndvi - parsedTiffData.stats.mean).toFixed(3)})</span>
                  )}
                </div>
              </div>
            )}

            <div className="forecast-table-container">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <h3 style={{ margin: 0 }}>📋 Predicted Trend Table (LSTM Output)</h3>
                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                  Model Training Loss: <strong style={{ color: 'var(--accent-purple-hover)' }}>{trainingLoss?.toFixed(6)}</strong>
                </span>
              </div>
              
              <div style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '8px' }}>
                <table className="forecast-table">
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th>Predicted Date</th>
                      <th>Forecasted NDVI</th>
                      <th>Vegetation Status</th>
                      <th>Rice Planting Guidance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {predictions && predictions.map((pred) => (
                      <tr key={pred.index}>
                        <td>+{pred.index} Month{pred.index > 1 ? 's' : ''}</td>
                        <td>{pred.date}</td>
                        <td>{pred.ndvi.toFixed(3)}</td>
                        <td>
                          <span className={`status-badge ${getStatusClass(pred.status)}`}>
                            <span className="status-badge-dot" />
                            {pred.status}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <span style={{ 
                              fontSize: '0.8rem', 
                              fontWeight: '600',
                              color: pred.rice_suitability?.includes('Highly') ? '#10b981' : 
                                     pred.rice_suitability?.includes('Moderately') ? '#f59e0b' : 
                                     pred.rice_suitability?.includes('Growing') ? '#3b82f6' : '#94a3b8'
                            }}>
                              {pred.rice_suitability || 'N/A'}
                            </span>
                            <span style={{ fontSize: '0.7rem', color: '#64748b' }}>{pred.rice_detail || 'No detailed guidance available'}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <button 
              className="forecast-btn" 
              style={{ background: 'rgba(255,255,255,0.05)', color: '#cbd5e1', alignSelf: 'flex-start' }}
              onClick={() => {
                setStep(2);
                setPredictions(null);
                setTrainingLoss(null);
              }}
            >
              Configure / Re-train Model
            </button>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div className="forecast-error">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
}
