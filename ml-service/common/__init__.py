"""Cross-cutting definitions shared by the pipeline, the trainers, the live
scoring path and the optimizer. Nothing here may import from data_pipeline,
models, or inference — this package sits below all three."""
