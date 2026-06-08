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
    def __init__(self, input_size=1, hidden_size=32, num_layers=1):
        self.input_size = input_size
        self.hidden_size = hidden_size
        self.num_layers = num_layers
        if HAS_TORCH:
            self.model = NDVILSTM(input_size=input_size, hidden_layer_size=hidden_size, num_layers=num_layers)
        else:
            self.model = None
        if HAS_NUMPY:
            # Fit multiple MinMaxScaler objects, one for each feature
            self.scalers = [MinMaxScaler(feature_range=(-1, 1)) for _ in range(input_size)]
        else:
            self.scalers = []
        self.is_trained = False
        self.seq_length = 12

    def train_multivariate(self, features, epochs=None, lr=0.01, seq_length=None):
        """
        features: list of lists, where features[0] is NDVI, and features[1:] are climate lists.
        """
        # If no PyTorch, fallback
        if not HAS_TORCH:
            self.is_trained = True
            return 0.001

        ndvi_series = features[0]
        n_samples = len(ndvi_series)

        # Dynamic parameter scaling based on data size:
        # Smaller histories need shorter windows to generate enough training samples, and smaller LSTMs
        if seq_length is None:
            if n_samples >= 36:
                seq_length = 12
            elif n_samples >= 24:
                seq_length = 8
            else:
                seq_length = max(3, n_samples // 3)
        
        self.seq_length = seq_length

        if n_samples <= seq_length:
            raise ValueError(f"Need more than {seq_length} data points to train, got {n_samples}")

        # Set training epochs dynamically (smaller datasets require more epochs to fit)
        if epochs is None:
            if n_samples < 24:
                epochs = 300
            elif n_samples < 40:
                epochs = 200
            else:
                epochs = 150

        # Dynamically scale down hidden size/layers for small datasets to prevent flattening/overfitting
        if n_samples < 24:
            self.hidden_size = 16
            self.num_layers = 1
        elif n_samples < 48:
            self.hidden_size = 32
            self.num_layers = 1
        else:
            self.hidden_size = 64
            self.num_layers = 2

        # Re-initialize the model with the adjusted sizing
        self.model = NDVILSTM(
            input_size=self.input_size, 
            hidden_layer_size=self.hidden_size, 
            num_layers=self.num_layers
        )

        # Scale all features independently
        scaled_features = []
        for idx, series in enumerate(features):
            series_arr = np.array(series, dtype=np.float32).reshape(-1, 1)
            scaled = self.scalers[idx].fit_transform(series_arr)
            scaled_features.append(scaled)

        # Merge features into shape: (length, input_size)
        data = np.hstack(scaled_features)

        # Build multivariate sequences
        X, y = [], []
        for i in range(len(data) - seq_length):
            X.append(data[i : (i + seq_length)])
            # We predict NDVI target only (first index)
            y.append(data[i + seq_length, 0])

        X_np = np.array(X, dtype=np.float32)
        y_np = np.array(y, dtype=np.float32)

        X_tensor = torch.FloatTensor(X_np)
        y_tensor = torch.FloatTensor(y_np).view(-1, 1)

        # Train model
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

    def predict_future_multivariate(self, features, months_ahead=6, seq_length=None):
        """
        Predict future NDVI. If climate values are used, we repeat the last known climate state
        or cycle monthly averages.
        """
        if not HAS_TORCH:
            return self._predict_fallback(features[0], months_ahead)

        if seq_length is None:
            seq_length = self.seq_length

        if not self.is_trained:
            self.train_multivariate(features, seq_length=seq_length)

        self.model.eval()

        # Scale historical inputs
        scaled_features = []
        for idx, series in enumerate(features):
            series_arr = np.array(series, dtype=np.float32).reshape(-1, 1)
            scaled = self.scalers[idx].transform(series_arr)
            scaled_features.append(scaled)

        # Shape (length, input_size)
        data = np.hstack(scaled_features)
        
        # Grab the last historical window
        history_window = data[-seq_length:]
        
        # Reshape to (1, seq_length, input_size)
        current_sequence = torch.FloatTensor(history_window).view(1, seq_length, self.input_size)

        # To project weather variables forward, we cycle the last historical climate inputs
        future_climate = []
        if self.input_size > 1:
            history_len = len(history_window)
            cycle_len = min(12, history_len)
            for m in range(months_ahead):
                # Cycle index from history window
                cycle_idx = -cycle_len + (m % cycle_len)
                future_climate.append(history_window[cycle_idx, 1:])

        predictions = []
        with torch.no_grad():
            for m in range(months_ahead):
                pred = self.model(current_sequence)
                pred_val = pred.item()
                predictions.append(pred_val)

                # Construct next input step
                if self.input_size > 1:
                    climate_step = future_climate[m]
                    next_step = np.concatenate(([pred_val], climate_step)).reshape(1, 1, self.input_size)
                else:
                    next_step = np.array([[[pred_val]]])
                
                next_step_tensor = torch.FloatTensor(next_step)
                current_sequence = torch.cat((current_sequence[:, 1:, :], next_step_tensor), dim=1)

        # Inverse scale predictions using NDVI scaler (index 0)
        rescaled_preds = self.scalers[0].inverse_transform(np.array(predictions).reshape(-1, 1))

        # Reconstruct unscaled climate variables for planting recommendation analysis
        unscaled_climate = []
        if self.input_size > 1:
            for m in range(months_ahead):
                scaled_step = future_climate[m]
                climate_step_unscaled = []
                for idx, val in enumerate(scaled_step):
                    unscaled_val = self.scalers[idx + 1].inverse_transform(np.array([[val]]))[0, 0]
                    climate_step_unscaled.append(unscaled_val)
                unscaled_climate.append(climate_step_unscaled)

        # Format output
        formatted_predictions = []
        for i, val in enumerate(rescaled_preds.flatten().tolist()):
            val = float(max(-1.0, min(1.0, val)))
            
            if val >= 0.40:
                status = "Fresh & Healthy"
            elif val >= 0.20:
                status = "Dry / Moderately Green"
            else:
                status = "Barren / Stressed / Urban"

            # Determine Rice Planting Suitability
            suitability = "N/A"
            suitability_detail = "Climate data unavailable"
            
            if self.input_size > 1:
                # climate variables: [temp, precip, soil_moisture]
                temp, precip, soil = unscaled_climate[i]
                
                # Temperature optimal check (20C - 35C)
                temp_ok = 20.0 <= temp <= 35.0
                # Rain threshold (at planting, wet soil is critical, precipitation >= 100mm/month or soil moisture >= 0.25)
                water_ok = precip >= 100.0 or soil >= 0.28
                
                if val < 0.25: # Low NDVI indicates pre-planting preparation or empty fields ready for planting
                    if temp_ok and water_ok:
                        suitability = "Highly Suitable"
                        suitability_detail = f"Optimal conditions: Temp {temp:.1f}°C, Monthly Rain {precip:.1f}mm"
                    elif temp_ok:
                        suitability = "Moderately Suitable"
                        suitability_detail = "Temperatures are good, but rainfall is slightly low for flooded fields"
                    else:
                        suitability = "Unsuitable"
                        suitability_detail = "Temperatures are too extreme for early seedling growth"
                else: # Active vegetative growth stage
                    suitability = "Growing Stage"
                    suitability_detail = f"Active vegetative growth. Temp: {temp:.1f}°C, Rain: {precip:.1f}mm"
            else:
                # Univariate fallback: check only NDVI
                if val < 0.22:
                    suitability = "Possible Planting Window"
                    suitability_detail = "NDVI represents open ground, but local water levels should be checked"
                else:
                    suitability = "Growing Stage"
                    suitability_detail = "High NDVI shows active crop cover"
                
            formatted_predictions.append({
                "index": i + 1,
                "ndvi": round(val, 3),
                "status": status,
                "rice_suitability": suitability,
                "rice_detail": suitability_detail
            })
            
        return formatted_predictions

    def train(self, raw_ndvi_series, epochs=150, lr=0.01, seq_length=None):
        return self.train_multivariate([raw_ndvi_series], epochs, lr, seq_length)

    def predict_future(self, raw_history, months_ahead=6, seq_length=None):
        return self.predict_future_multivariate([raw_history], months_ahead, seq_length)

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
