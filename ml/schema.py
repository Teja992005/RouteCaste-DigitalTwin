import math


ETA_FEATURES = [
    "distance_km_over_10",
    "current_travel_time_log",
    "current_congestion",
    "current_speed_normalized",
    "hour_sin",
    "hour_cos",
    "event_proximity",
    "scenario_severity",
    "event_load",
]


CONGESTION_FEATURES = [
    "current_congestion",
    "step_over_6",
    "current_speed_normalized",
    "road_capacity_normalized",
    "hour_sin",
    "hour_cos",
    "incident_load",
    "scenario_severity",
    "event_proximity",
]


CONGESTION_CLASSES = [
    "free",
    "light",
    "moderate",
    "heavy",
    "severe",
]


ETA_INPUT_DIM = len(
    ETA_FEATURES
)

CONGESTION_INPUT_DIM = len(
    CONGESTION_FEATURES
)

CONGESTION_OUTPUT_DIM = len(
    CONGESTION_CLASSES
)


def hour_cyclical(
    hour: float
):

    rad = (
        2
        * math.pi
        * (hour / 24.0)
    )

    return (
        math.sin(rad),
        math.cos(rad),
    )