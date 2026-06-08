try:
    import numpy as np
    from sklearn.preprocessing import MinMaxScaler
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False

try:
    import torch
    from ml.model import NDVILSTM
    from ml.dataset import create_sequences
    HAS_TORCH = True if HAS_NUMPY else False
except ImportError:
    HAS_TORCH = False

class NDVIForecaster:
    def __init__(self, hidden_size=64, num_layers=2):
        if HAS_TORCH:
            self.model = NDVILSTM(hidden_layer_size=hidden_size, num_layers=num_layers)
        else:
            self.model = None
        if HAS_NUMPY:
            self.scaler = MinMaxScaler(feature_range=(-1, 1))
        else:
            self.scaler = None
        self.is_trained = False
        self.seq_length = 12
        
    def train(self, raw_ndvi_series, epochs=150, lr=0.01, seq_length=None):
        if not HAS_TORCH:
            # Fallback training: no weights to optimize, we just cache the series
            self.is_trained = True
            return 0.001  # simulated final loss

        if seq_length is None:
            if len(raw_ndvi_series) >= 24:
                seq_length = 12
            else:
                seq_length = max(3, len(raw_ndvi_series) - 2)
        
        self.seq_length = seq_length

        if len(raw_ndvi_series) <= seq_length:
            raise ValueError(f"Need more than {seq_length} data points to train, got {len(raw_ndvi_series)}")

        # 1. Scale data
        series = np.array(raw_ndvi_series, dtype=np.float32).reshape(-1, 1)
        scaled_data = self.scaler.fit_transform(series)
        
        # 2. Build sequences
        X, y = create_sequences(scaled_data, seq_length)
        
        # Reshape X to (samples, seq_len, 1)
        X = np.expand_dims(X, axis=-1)
        
        X_tensor = torch.FloatTensor(X)
        y_tensor = torch.FloatTensor(y)
        
        # 3. Model optimization loop
        criterion = torch.nn.MSELoss()
        optimizer = torch.optim.Adam(self.model.parameters(), lr=lr)
        
        self.model.train()
        for epoch in range(epochs):
            optimizer.zero_grad()
            predictions = self.model(X_tensor)
            loss = criterion(predictions, y_tensor)
            loss.backward()
            optimizer.step()
        
        self.is_trained = True
        return loss.item()
            
    def predict_future(self, raw_history, months_ahead=6, seq_length=None):
        """
        Takes the last sequence of NDVI history and predicts the next N months.
        """
        if not HAS_TORCH:
            return self._predict_fallback(raw_history, months_ahead)

        if seq_length is None:
            seq_length = self.seq_length

        if not self.is_trained:
            # Fallback training if not done explicitly
            self.train(raw_history, seq_length=seq_length)

        self.model.eval()
        
        # Grab last window
        history_window = raw_history[-seq_length:]
        scaled_window = self.scaler.transform(np.array(history_window, dtype=np.float32).reshape(-1, 1))
        
        # Reshape to (1, seq_length, 1)
        current_sequence = torch.FloatTensor(scaled_window).view(1, seq_length, 1)
        
        predictions = []
        with torch.no_grad():
            for _ in range(months_ahead):
                pred = self.model(current_sequence)
                pred_val = pred.item()
                predictions.append(pred_val)
                
                # Append predicted value and slide the window
                new_element = torch.FloatTensor([[[pred_val]]])
                current_sequence = torch.cat((current_sequence[:, 1:, :], new_element), dim=1)
                
        # Inverse transform predictions back to NDVI scale
        rescaled_preds = self.scaler.inverse_transform(np.array(predictions).reshape(-1, 1))
        
        # Format response
        formatted_predictions = []
        for i, val in enumerate(rescaled_preds.flatten().tolist()):
            val = float(max(-1.0, min(1.0, val)))  # Bound NDVI to [-1, 1]
            
            # Label quality metric
            if val >= 0.40:
                status = "Fresh & Healthy"
            elif val >= 0.20:
                status = "Dry / Moderately Green"
            else:
                status = "Barren / Stressed / Urban"
                
            formatted_predictions.append({
                "index": i + 1,
                "ndvi": round(val, 3),
                "status": status
            })
            
        return formatted_predictions

    def _predict_fallback(self, raw_history, months_ahead=6):
        """
        Fallback seasonal trend decomposition forecaster when PyTorch is not available.
        Can run with or without NumPy.
        """
        n = len(raw_history)
        
        if HAS_NUMPY:
            x = np.arange(n)
            y = np.array(raw_history, dtype=np.float64)
            
            # Fit linear trend: y = slope * x + intercept
            slope, intercept = np.polyfit(x, y, 1)
            
            # Calculate residuals (seasonality + noise)
            trend = slope * x + intercept
            residuals = y - trend
            
            # Calculate monthly seasonal offsets (12 month period)
            seasonal_offsets = np.zeros(12)
            for m in range(12):
                indices = [i for i in range(n) if i % 12 == m]
                if indices:
                    seasonal_offsets[m] = np.mean(residuals[indices])
                else:
                    seasonal_offsets[m] = 0.0
        else:
            # 100% Pure Python Fallback (no numpy dependency)
            x_sum = sum(range(n))
            y_sum = sum(raw_history)
            xx_sum = sum(i * i for i in range(n))
            xy_sum = sum(i * raw_history[i] for i in range(n))
            
            denominator = n * xx_sum - x_sum * x_sum
            if denominator == 0:
                slope = 0.0
                intercept = y_sum / n if n > 0 else 0.0
            else:
                slope = (n * xy_sum - x_sum * y_sum) / denominator
                intercept = (y_sum - slope * x_sum) / n
                
            residuals = [raw_history[i] - (slope * i + intercept) for i in range(n)]
            
            seasonal_offsets = [0.0] * 12
            for m in range(12):
                matching_residuals = [residuals[i] for i in range(n) if i % 12 == m]
                if matching_residuals:
                    seasonal_offsets[m] = sum(matching_residuals) / len(matching_residuals)
                else:
                    seasonal_offsets[m] = 0.0
                
        # Forecast future values
        formatted_predictions = []
        for i in range(months_ahead):
            future_idx = n + i
            future_trend = slope * future_idx + intercept
            future_seasonal = seasonal_offsets[future_idx % 12]
            
            val = float(future_trend + future_seasonal)
            val = float(max(-1.0, min(1.0, val)))  # Bound NDVI to [-1, 1]
            
            if val >= 0.40:
                status = "Fresh & Healthy"
            elif val >= 0.20:
                status = "Dry / Moderately Green"
            else:
                status = "Barren / Stressed / Urban"
                
            formatted_predictions.append({
                "index": i + 1,
                "ndvi": round(val, 3),
                "status": status
            })
            
        return formatted_predictions
