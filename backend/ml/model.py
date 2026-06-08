import torch
import torch.nn as nn

class NDVILSTM(nn.Module):
    def __init__(self, input_size=1, hidden_layer_size=64, output_size=1, num_layers=2):
        super().__init__()
        self.hidden_layer_size = hidden_layer_size
        self.num_layers = num_layers
        
        self.lstm = nn.LSTM(
            input_size=input_size,
            hidden_size=hidden_layer_size,
            num_layers=num_layers,
            batch_first=True,
            dropout=0.2 if num_layers > 1 else 0.0
        )
        
        self.linear = nn.Linear(hidden_layer_size, output_size)

    def forward(self, input_seq):
        # input_seq: (batch_size, seq_len, input_size)
        lstm_out, _ = self.lstm(input_seq)
        # Gather final time-step hidden output
        last_step_out = lstm_out[:, -1, :]
        predictions = self.linear(last_step_out)
        return predictions
