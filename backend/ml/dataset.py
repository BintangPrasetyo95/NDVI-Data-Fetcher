import numpy as np

def create_sequences(data, sequence_length=12):
    """
    Splits continuous time-series data into training sequence windows.
    E.g. with sequence_length=12:
    X: [val_1, ..., val_12] -> y: [val_13]
    """
    xs, ys = [], []
    for i in range(len(data) - sequence_length):
        x = data[i : (i + sequence_length)]
        y = data[i + sequence_length]
        xs.append(x)
        ys.append(y)
    return np.array(xs, dtype=np.float32), np.array(ys, dtype=np.float32)
