# FRC Driver Lab planning

Product, architecture, and implementation planning for an FRC robot driver practice and assessment application.

- [Editable specification](docs/product-architecture-implementation.md)
- [Printable PDF](output/pdf/frc-driver-lab-specification.pdf)

Recommended direction: desktop web with TypeScript, Three.js, Rapier, and React, subject to an early USB-controller and physics feasibility gate on Windows and macOS.

This repository currently contains planning documents, not a working simulator. Scores, physics parameters, and estimates in the specification are proposed and require validation.

The specification treats polished graphics as a first-release requirement, with physically based materials, detailed robot models, deliberate lighting, scalable quality tiers, and measured performance/memory budgets.

To rebuild the PDF on macOS, run `python3 scripts/build_specification.py` with ReportLab installed. The builder uses Arial and Andale Mono from the system font directory. Render the resulting PDF and inspect pagination after editing the source.
