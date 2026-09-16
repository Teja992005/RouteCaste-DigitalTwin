"""
RouteCast Production ML Training Pipeline

Models:

    Model 1:
        ETA regression

    Model 2:
        Congestion classification

ETA target:

    log(
        future_travel_time
        /
        current_travel_time
    )

Congestion classes:

    0 = free
    1 = light
    2 = moderate
    3 = heavy
    4 = severe
"""

from __future__ import annotations

import json
import random
from pathlib import Path

import numpy as np

import torch
import torch.nn as nn

from torch.utils.data import (
    DataLoader,
    TensorDataset,
)

from data import (
    load_eta_data,
    load_congestion_data,
)

from schema import (
    ETA_INPUT_DIM,
    CONGESTION_INPUT_DIM,
    CONGESTION_CLASSES,
    CONGESTION_OUTPUT_DIM,
)


# ============================================================
# CONFIGURATION
# ============================================================

SEED = 42

DEVICE = torch.device(
    "cuda"
    if torch.cuda.is_available()
    else "cpu"
)

BATCH_SIZE = 512

EPOCHS = 50

LEARNING_RATE = 1e-3

WEIGHT_DECAY = 1e-5

PATIENCE = 10


MODEL_DIR = (
    Path(__file__).resolve().parent.parent
    / "models"
)

MODEL_DIR.mkdir(
    parents=True,
    exist_ok=True,
)


# ============================================================
# REPRODUCIBILITY
# ============================================================

random.seed(
    SEED
)

np.random.seed(
    SEED
)

torch.manual_seed(
    SEED
)

if torch.cuda.is_available():

    torch.cuda.manual_seed_all(
        SEED
    )


# ============================================================
# MODEL
# ============================================================

class TrafficMLP(
    nn.Module
):

    def __init__(
        self,
        input_dim: int,
        output_dim: int,
    ):

        super().__init__()

        self.network = nn.Sequential(

            nn.Linear(
                input_dim,
                128,
            ),

            nn.ReLU(),

            nn.Dropout(
                0.10
            ),

            nn.Linear(
                128,
                128,
            ),

            nn.ReLU(),

            nn.Dropout(
                0.10
            ),

            nn.Linear(
                128,
                64,
            ),

            nn.ReLU(),

            nn.Linear(
                64,
                output_dim,
            ),
        )

    def forward(
        self,
        x,
    ):

        return self.network(
            x
        )


# ============================================================
# REGRESSION METRICS
# ============================================================

def regression_metrics(
    actual,
    predicted,
):

    actual = np.asarray(
        actual,
        dtype=np.float64,
    ).reshape(-1)

    predicted = np.asarray(
        predicted,
        dtype=np.float64,
    ).reshape(-1)

    error = (
        predicted
        - actual
    )

    abs_error = np.abs(
        error
    )

    mae = float(
        np.mean(
            abs_error
        )
    )

    rmse = float(
        np.sqrt(
            np.mean(
                error ** 2
            )
        )
    )

    ss_res = float(
        np.sum(
            error ** 2
        )
    )

    ss_tot = float(
        np.sum(
            (
                actual
                - np.mean(actual)
            )
            ** 2
        )
    )

    if ss_tot > 0:

        r2 = (
            1.0
            - ss_res / ss_tot
        )

    else:

        r2 = 0.0

    return {
        "mae": mae,
        "rmse": rmse,
        "r2": float(r2),
        "median_absolute_error": float(
            np.percentile(
                abs_error,
                50,
            )
        ),
        "p90_absolute_error": float(
            np.percentile(
                abs_error,
                90,
            )
        ),
        "p95_absolute_error": float(
            np.percentile(
                abs_error,
                95,
            )
        ),
    }


# ============================================================
# ETA ACCURACY
# ============================================================

def eta_accuracy_metrics(
    actual_eta,
    predicted_eta,
):

    actual_eta = np.asarray(
        actual_eta,
        dtype=np.float64,
    ).reshape(-1)

    predicted_eta = np.asarray(
        predicted_eta,
        dtype=np.float64,
    ).reshape(-1)

    denominator = np.maximum(
        np.abs(
            actual_eta
        ),
        1.0,
    )

    relative_error = (
        np.abs(
            predicted_eta
            - actual_eta
        )
        / denominator
    )

    return {
        "within_10_percent": float(
            np.mean(
                relative_error
                <= 0.10
            )
        ),
        "within_20_percent": float(
            np.mean(
                relative_error
                <= 0.20
            )
        ),
        "within_30_percent": float(
            np.mean(
                relative_error
                <= 0.30
            )
        ),
    }


# ============================================================
# CONGESTION METRICS
# ============================================================

def congestion_metrics(
    actual,
    predicted,
):

    actual = np.asarray(
        actual,
        dtype=np.int64,
    ).reshape(-1)

    predicted = np.asarray(
        predicted,
        dtype=np.int64,
    ).reshape(-1)

    # --------------------------------------------------------
    # Exact accuracy
    # --------------------------------------------------------

    exact_accuracy = float(
        np.mean(
            actual
            == predicted
        )
    )

    # --------------------------------------------------------
    # Adjacent accuracy
    #
    # Prediction is considered acceptable if it is at most
    # one congestion level away.
    # --------------------------------------------------------

    adjacent_accuracy = float(
        np.mean(
            np.abs(
                actual
                - predicted
            )
            <= 1
        )
    )

    # --------------------------------------------------------
    # Per-class metrics
    # --------------------------------------------------------

    per_class = {}

    for class_index, class_name in enumerate(
        CONGESTION_CLASSES
    ):

        true_positive = np.sum(
            (
                actual
                == class_index
            )
            &
            (
                predicted
                == class_index
            )
        )

        false_positive = np.sum(
            (
                actual
                != class_index
            )
            &
            (
                predicted
                == class_index
            )
        )

        false_negative = np.sum(
            (
                actual
                == class_index
            )
            &
            (
                predicted
                != class_index
            )
        )

        precision_denominator = (
            true_positive
            + false_positive
        )

        recall_denominator = (
            true_positive
            + false_negative
        )

        if precision_denominator > 0:

            precision = (
                true_positive
                / precision_denominator
            )

        else:

            precision = 0.0

        if recall_denominator > 0:

            recall = (
                true_positive
                / recall_denominator
            )

        else:

            recall = 0.0

        if (
            precision
            + recall
        ) > 0:

            f1 = (
                2
                * precision
                * recall
                / (
                    precision
                    + recall
                )
            )

        else:

            f1 = 0.0

        per_class[class_name] = {
            "precision": float(
                precision
            ),
            "recall": float(
                recall
            ),
            "f1": float(
                f1
            ),
            "support": int(
                np.sum(
                    actual
                    == class_index
                )
            ),
        }

    # --------------------------------------------------------
    # Macro F1
    # --------------------------------------------------------

    macro_f1 = float(
        np.mean(
            [
                metrics["f1"]
                for metrics
                in per_class.values()
            ]
        )
    )

    # --------------------------------------------------------
    # Confusion matrix
    # --------------------------------------------------------

    confusion = np.zeros(
        (
            CONGESTION_OUTPUT_DIM,
            CONGESTION_OUTPUT_DIM,
        ),
        dtype=np.int64,
    )

    for actual_class, predicted_class in zip(
        actual,
        predicted,
    ):

        if (
            0 <= actual_class
            < CONGESTION_OUTPUT_DIM
            and
            0 <= predicted_class
            < CONGESTION_OUTPUT_DIM
        ):

            confusion[
                actual_class,
                predicted_class,
            ] += 1

    return {
        "exact_accuracy": exact_accuracy,
        "within_one_class_accuracy": adjacent_accuracy,
        "macro_f1": macro_f1,
        "per_class": per_class,
        "confusion_matrix": confusion.tolist(),
    }


# ============================================================
# TRAINING
# ============================================================

def train_model(
    name,
    datasets,
    loss_function,
    output_dim,
):

    print(
        "\n"
        + "=" * 70
    )

    print(
        f" TRAINING {name.upper()} MODEL"
    )

    print(
        "=" * 70
    )

    X_train, y_train = (
        datasets["train"]
    )

    X_val, y_val = (
        datasets["val"]
    )

    X_test, y_test = (
        datasets["test"]
    )

    print(
        f"Train: {X_train.shape}"
    )

    print(
        f"Val:   {X_val.shape}"
    )

    print(
        f"Test:  {X_test.shape}"
    )

    input_dim = (
        X_train.shape[1]
    )

    model = TrafficMLP(
        input_dim=input_dim,
        output_dim=output_dim,
    ).to(
        DEVICE
    )

    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=LEARNING_RATE,
        weight_decay=WEIGHT_DECAY,
    )

    train_dataset = TensorDataset(
        torch.from_numpy(
            X_train
        ),
        torch.from_numpy(
            y_train
        ),
    )

    val_dataset = TensorDataset(
        torch.from_numpy(
            X_val
        ),
        torch.from_numpy(
            y_val
        ),
    )

    train_loader = DataLoader(
        train_dataset,
        batch_size=BATCH_SIZE,
        shuffle=True,
        num_workers=0,
    )

    val_loader = DataLoader(
        val_dataset,
        batch_size=BATCH_SIZE,
        shuffle=False,
        num_workers=0,
    )

    best_val_loss = float(
        "inf"
    )

    best_state = None

    patience_counter = 0

    history = []

    # ========================================================
    # EPOCHS
    # ========================================================

    for epoch in range(
        1,
        EPOCHS + 1,
    ):

        # ----------------------------------------------------
        # TRAIN
        # ----------------------------------------------------

        model.train()

        train_losses = []

        for (
            X_batch,
            y_batch,
        ) in train_loader:

            X_batch = X_batch.to(
                DEVICE
            )

            y_batch = y_batch.to(
                DEVICE
            )

            optimizer.zero_grad()

            prediction = model(
                X_batch
            )

            loss = loss_function(
                prediction,
                y_batch,
            )

            loss.backward()

            torch.nn.utils.clip_grad_norm_(
                model.parameters(),
                max_norm=5.0,
            )

            optimizer.step()

            train_losses.append(
                loss.item()
            )

        train_loss = float(
            np.mean(
                train_losses
            )
        )

        # ----------------------------------------------------
        # VALIDATION
        # ----------------------------------------------------

        model.eval()

        val_losses = []

        with torch.no_grad():

            for (
                X_batch,
                y_batch,
            ) in val_loader:

                X_batch = X_batch.to(
                    DEVICE
                )

                y_batch = y_batch.to(
                    DEVICE
                )

                prediction = model(
                    X_batch
                )

                loss = loss_function(
                    prediction,
                    y_batch,
                )

                val_losses.append(
                    loss.item()
                )

        val_loss = float(
            np.mean(
                val_losses
            )
        )

        history.append(
            {
                "epoch": epoch,
                "train_loss": train_loss,
                "val_loss": val_loss,
            }
        )

        print(
            f"Epoch {epoch:02d}/{EPOCHS} "
            f"| train={train_loss:.6f} "
            f"| val={val_loss:.6f}"
        )

        # ----------------------------------------------------
        # EARLY STOPPING
        # ----------------------------------------------------

        if (
            val_loss
            < best_val_loss
        ):

            best_val_loss = (
                val_loss
            )

            best_state = {
                key: value.detach()
                .cpu()
                .clone()
                for key, value
                in model.state_dict()
                .items()
            }

            patience_counter = 0

        else:

            patience_counter += 1

            if (
                patience_counter
                >= PATIENCE
            ):

                print(
                    f"\nEarly stopping "
                    f"at epoch {epoch}."
                )

                break

    # ========================================================
    # RESTORE BEST
    # ========================================================

    if best_state is not None:

        model.load_state_dict(
            best_state
        )

    model.eval()

    # ========================================================
    # TEST PREDICTION
    # ========================================================

    X_test_tensor = (
        torch.from_numpy(
            X_test
        ).to(
            DEVICE
        )
    )

    with torch.no_grad():

        prediction = model(
            X_test_tensor
        ).cpu().numpy()

    return (
        model,
        prediction,
        history,
        best_val_loss,
    )


# ============================================================
# ONNX EXPORT
# ============================================================

def export_onnx(
    model,
    input_dim,
    output_dim,
    path,
):

    model = model.to(
        "cpu"
    )

    model.eval()

    dummy_input = torch.randn(
        1,
        input_dim,
        dtype=torch.float32,
    )

    torch.onnx.export(
        model,
        dummy_input,
        path,
        input_names=[
            "input"
        ],
        output_names=[
            "output"
        ],
        dynamic_axes={
            "input": {
                0: "batch"
            },
            "output": {
                0: "batch"
            },
        },
        opset_version=18,
    )

    print(
        f"ONNX exported: {path}"
    )


# ============================================================
# ONNX PARITY
# ============================================================

def verify_onnx(
    model,
    onnx_path,
    X,
):

    try:

        import onnxruntime as ort

    except ImportError:

        print(
            "onnxruntime not installed; "
            "skipping parity check."
        )

        return None

    model = model.to(
        "cpu"
    )

    model.eval()

    sample = X[
        :1000
    ].astype(
        np.float32
    )

    with torch.no_grad():

        torch_output = (
            model(
                torch.from_numpy(
                    sample
                )
            )
            .numpy()
        )

    session = (
        ort.InferenceSession(
            str(onnx_path),
            providers=[
                "CPUExecutionProvider"
            ],
        )
    )

    onnx_output = (
        session.run(
            ["output"],
            {
                "input": sample
            },
        )[0]
    )

    max_difference = float(
        np.max(
            np.abs(
                torch_output
                - onnx_output
            )
        )
    )

    print(
        "ONNX parity max "
        f"difference: "
        f"{max_difference:.8f}"
    )

    return max_difference


# ============================================================
# ETA EVALUATION
# ============================================================

def evaluate_eta(
    prediction_log_factor,
    X_test,
    y_test,
):
    """
    Convert log factor prediction back into ETA.

    Feature index 1 contains:

        normalized(log1p(current_eta))

    Therefore:

        current_eta =
            expm1(
                normalized
                * log1p(3600)
            )
    """

    current_eta_normalized = (
        X_test[:, 1]
    )

    current_eta = np.expm1(
        current_eta_normalized
        * np.log1p(
            3600.0
        )
    )

    predicted_log_factor = (
        prediction_log_factor
        .reshape(-1)
    )

    actual_log_factor = (
        y_test
        .reshape(-1)
    )

    predicted_factor = np.exp(
        predicted_log_factor
    )

    actual_factor = np.exp(
        actual_log_factor
    )

    predicted_eta = (
        current_eta
        * predicted_factor
    )

    actual_eta = (
        current_eta
        * actual_factor
    )

    # Keep production ETA bounded.
    predicted_eta = np.clip(
        predicted_eta,
        0.0,
        3600.0,
    )

    actual_eta = np.clip(
        actual_eta,
        0.0,
        3600.0,
    )

    metrics = regression_metrics(
        actual_eta,
        predicted_eta,
    )

    metrics.update(
        eta_accuracy_metrics(
            actual_eta,
            predicted_eta,
        )
    )

    return (
        metrics,
        actual_eta,
        predicted_eta,
    )


# ============================================================
# MAIN
# ============================================================

def main():

    print(
        "\n"
        + "=" * 70
    )

    print(
        " RouteCast Production ML Training Pipeline"
    )

    print(
        "=" * 70
    )

    print(
        f"Device: {DEVICE}"
    )

    print(
        "ETA samples: 200,000"
    )

    print(
        "Congestion samples: 200,000"
    )

    print(
        f"Batch size: {BATCH_SIZE}"
    )

    print(
        f"Epochs: {EPOCHS}"
    )

    print(
        "=" * 70
    )

    all_metrics = {}

    all_history = {}

    # ========================================================
    # ETA
    # ========================================================

    print(
        "\n"
        + "=" * 70
    )

    print(
        " PHASE 1: ETA MODEL"
    )

    print(
        "=" * 70
    )

    eta_data = (
        load_eta_data()
    )

    (
        eta_model,
        eta_prediction,
        eta_history,
        eta_best_loss,
    ) = train_model(
        name="eta",
        datasets=eta_data,
        loss_function=nn.SmoothL1Loss(),
        output_dim=1,
    )

    eta_X_test, eta_y_test = (
        eta_data["test"]
    )

    (
        eta_metrics,
        actual_eta,
        predicted_eta,
    ) = evaluate_eta(
        eta_prediction,
        eta_X_test,
        eta_y_test,
    )

    print(
        "\nETA TEST RESULTS"
    )

    print(
        "-" * 50
    )

    for (
        key,
        value,
    ) in eta_metrics.items():

        if key.startswith(
            "within_"
        ):

            print(
                f"{key:25s}: "
                f"{value * 100:.2f}%"
            )

        else:

            print(
                f"{key:25s}: "
                f"{value:.6f}"
            )

    eta_path = (
        MODEL_DIR
        / "eta.onnx"
    )

    export_onnx(
        eta_model,
        ETA_INPUT_DIM,
        1,
        eta_path,
    )

    eta_parity = verify_onnx(
        eta_model,
        eta_path,
        eta_X_test,
    )

    all_metrics[
        "eta"
    ] = eta_metrics

    all_metrics[
        "eta"
    ][
        "best_validation_loss"
    ] = eta_best_loss

    all_metrics[
        "eta"
    ][
        "onnx_max_difference"
    ] = eta_parity

    all_history[
        "eta"
    ] = eta_history

    # ========================================================
    # CONGESTION
    # ========================================================

    print(
        "\n"
        + "=" * 70
    )

    print(
        " PHASE 2: CONGESTION MODEL"
    )

    print(
        "=" * 70
    )

    congestion_data = (
        load_congestion_data()
    )

    (
        congestion_model,
        congestion_logits,
        congestion_history,
        congestion_best_loss,
    ) = train_model(
        name="congestion",
        datasets=congestion_data,
        loss_function=nn.CrossEntropyLoss(),
        output_dim=CONGESTION_OUTPUT_DIM,
    )

    congestion_X_test, congestion_y_test = (
        congestion_data["test"]
    )

    # --------------------------------------------------------
    # Convert logits -> probabilities
    # --------------------------------------------------------

    probabilities = torch.softmax(
        torch.from_numpy(
            congestion_logits
        ),
        dim=1,
    ).numpy()

    predicted_classes = (
        np.argmax(
            probabilities,
            axis=1,
        )
    )

    # --------------------------------------------------------
    # Metrics
    # --------------------------------------------------------

    congestion_result = (
        congestion_metrics(
            congestion_y_test,
            predicted_classes,
        )
    )

    print(
        "\nCONGESTION TEST RESULTS"
    )

    print(
        "-" * 50
    )

    print(
        "Exact accuracy:"
        f" "
        f"{congestion_result['exact_accuracy'] * 100:.2f}%"
    )

    print(
        "Within ±1 class:"
        f" "
        f"{congestion_result['within_one_class_accuracy'] * 100:.2f}%"
    )

    print(
        "Macro F1:"
        f" "
        f"{congestion_result['macro_f1']:.4f}"
    )

    # --------------------------------------------------------
    # Per-class
    # --------------------------------------------------------

    print(
        "\nPER-CLASS RESULTS"
    )

    print(
        "-" * 70
    )

    print(
        f"{'Class':12s}"
        f"{'Precision':12s}"
        f"{'Recall':12s}"
        f"{'F1':12s}"
        f"{'Support':12s}"
    )

    for class_name in (
        CONGESTION_CLASSES
    ):

        metrics = (
            congestion_result[
                "per_class"
            ][class_name]
        )

        print(
            f"{class_name:12s}"
            f"{metrics['precision'] * 100:10.2f}% "
            f"{metrics['recall'] * 100:10.2f}% "
            f"{metrics['f1'] * 100:10.2f}% "
            f"{metrics['support']:10d}"
        )

    # --------------------------------------------------------
    # Confusion matrix
    # --------------------------------------------------------

    print(
        "\nCONFUSION MATRIX"
    )

    print(
        "-" * 70
    )

    print(
        "Rows = actual"
    )

    print(
        "Columns = predicted"
    )

    print()

    print(
        "             "
        + " ".join(
            f"{name[:4]:>8s}"
            for name
            in CONGESTION_CLASSES
        )
    )

    confusion = (
        congestion_result[
            "confusion_matrix"
        ]
    )

    for index, class_name in enumerate(
        CONGESTION_CLASSES
    ):

        print(
            f"{class_name:10s}"
            + " ".join(
                f"{value:8d}"
                for value
                in confusion[index]
            )
        )

    # --------------------------------------------------------
    # Save probability metadata
    # --------------------------------------------------------

    all_metrics[
        "congestion"
    ] = congestion_result

    all_metrics[
        "congestion"
    ][
        "best_validation_loss"
    ] = congestion_best_loss

    all_history[
        "congestion"
    ] = congestion_history

    # --------------------------------------------------------
    # Export ONNX
    #
    # The ONNX output is raw logits:
    #
    # [free, light, moderate, heavy, severe]
    #
    # Node can apply softmax.
    # --------------------------------------------------------

    congestion_path = (
        MODEL_DIR
        / "congestion.onnx"
    )

    export_onnx(
        congestion_model,
        CONGESTION_INPUT_DIM,
        CONGESTION_OUTPUT_DIM,
        congestion_path,
    )

    congestion_parity = (
        verify_onnx(
            congestion_model,
            congestion_path,
            congestion_X_test,
        )
    )

    all_metrics[
        "congestion"
    ][
        "onnx_max_difference"
    ] = congestion_parity

    # ========================================================
    # SAVE METRICS
    # ========================================================

    metrics_path = (
        MODEL_DIR
        / "metrics.json"
    )

    with open(
        metrics_path,
        "w",
        encoding="utf-8",
    ) as file:

        json.dump(
            all_metrics,
            file,
            indent=2,
        )

    # ========================================================
    # SAVE HISTORY
    # ========================================================

    history_path = (
        MODEL_DIR
        / "training_history.json"
    )

    with open(
        history_path,
        "w",
        encoding="utf-8",
    ) as file:

        json.dump(
            all_history,
            file,
            indent=2,
        )

    # ========================================================
    # FINAL SUMMARY
    # ========================================================

    print(
        "\n"
        + "=" * 70
    )

    print(
        " TRAINING COMPLETE"
    )

    print(
        "=" * 70
    )

    print(
        "\nETA model:"
    )

    print(
        f"  {eta_path}"
    )

    print(
        "\nCongestion model:"
    )

    print(
        f"  {congestion_path}"
    )

    print(
        "\nMetrics:"
    )

    print(
        f"  {metrics_path}"
    )

    print(
        "\nHistory:"
    )

    print(
        f"  {history_path}"
    )

    print(
        "\n"
        + "=" * 70
    )


if __name__ == "__main__":

    main()