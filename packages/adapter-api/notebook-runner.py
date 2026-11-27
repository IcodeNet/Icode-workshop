"""Execute a real Python notebook; tagged assessment cells must actually execute."""
import os
import sys
import nbformat
from nbclient import NotebookClient

notebook = nbformat.read('notebook.ipynb', as_version=4)
assessments = [cell for cell in notebook.cells if cell.cell_type == 'code' and 'workshop-test' in cell.metadata.get('tags', []) and cell.source.strip()]
if sys.argv[1] == 'test' and not assessments:
    raise RuntimeError('No non-empty workshop-test cells found; cannot pass this notebook.')
client = NotebookClient(notebook, timeout=30, kernel_name='python3', allow_errors=False, resources={'metadata': {'path': os.getcwd()}})
try:
    client.execute()
finally:
    nbformat.write(notebook, 'notebook.executed.ipynb')
for cell in notebook.cells:
    for output in cell.get('outputs', []):
        if output.output_type == 'stream':
            print(output.text, end='')
if sys.argv[1] == 'test':
    if not all(cell.execution_count is not None for cell in assessments):
        raise RuntimeError('Assessment cells were not executed.')
    print(f'PASS: {len(assessments)} notebook assessment cells executed.')
