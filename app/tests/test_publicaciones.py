import sys
import json
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'herramientas'))
from publicaciones import extraer_resultado


class ResultadoEditorialTest(unittest.TestCase):
    def test_claude_y_codex_devuelven_el_mismo_objeto(self):
        self.assertEqual(extraer_resultado(json.dumps({'result': json.dumps({'titulo': 'GTA 6'})}), 'claude'), {'titulo': 'GTA 6'})
        self.assertEqual(extraer_resultado('```json\n{"titulo":"GTA 6"}\n```', 'codex'), {'titulo': 'GTA 6'})

    def test_salida_invalida_o_error_no_se_convierte_en_una_sugerencia(self):
        for texto, con in [('texto suelto', 'codex'), ('[]', 'codex'), ('{"is_error":true,"result":"sin acceso"}', 'claude')]:
            with self.assertRaises(ValueError):
                extraer_resultado(texto, con)
