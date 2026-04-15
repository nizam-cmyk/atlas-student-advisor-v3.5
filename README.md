# ATLAS FEST Advisor

ATLAS is an intake-aware FEST student advisor.

## Core rule
ATLAS does not use one mixed handbook.  
It loads the correct handbook pack based on the student's ID prefix.

## Intake routing
1. Student provides student ID
2. ATLAS reads the first 3 digits
3. Prefix is matched in `data/prefix_map.json`
4. The correct handbook pack is loaded:
   - `data/july/`
   - `data/november/`
   - `data/march/`

## Required folders

```text
data/
  registry.json
  prefix_map.json
  july/
  november/
  march/
sources/
  july_handbook.pdf
  november_handbook.pdf
  march_handbook.pdf