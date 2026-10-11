# Gallina Prófuga VR — Meta Quest 3 y Meta Quest 3S

Eres una gallina en una granja y Don Ramiro, el granjero, quiere degollarte. Un simulador de caos al estilo *I Am Cat*: cumples misiones de gallina (huevazos y popó a la gente, tirar cubetas, picotear al cerdo y a la vaca, derribar al espantapájaros, aterrizar volando en el molino…), subes de nivel y la dificultad crece. Funciona en **Meta Quest Browser (WebXR)** y en computadora con teclado y mouse, en **primera o tercera persona**.

## Cómo jugar en el Meta Quest 3 / 3S

1. En el visor, abre **Meta Quest Browser** y entra a la URL HTTPS publicada (GitHub Pages).
2. Pulsa **ENTER VR** y acepta la solicitud de acceso a VR.
3. Aprieta el **gatillo** para empezar.

| Acción | Meta Quest | Computadora |
|---|---|---|
| Moverte | Stick izquierdo | `W A S D` / flechas |
| Girar / mirar | Stick derecho (giro de 30°) | Mouse |
| Volar (mantén para subir, suelta y muévete para planear) | `A` / `X` | `Espacio` |
| Huevo (va a donde apuntas) | Gatillo | Clic izquierdo / `F` |
| Picotazo | Agarre (grip) | Clic derecho / `E` |
| Popó (sale por atrás) | `B` / `Y` | `Q` / clic central |
| Cambiar primera / tercera persona | Clic del stick derecho | `C` |

En VR te encoges: en primera persona tienes ojos de gallina y el granjero mide "siete metros"; en tercera persona ves a tu gallina desde atrás.

## Reglas

- **Vidas:** 3. Si Don Ramiro te alcanza, pierdes una y reapareces en el **gallinero**, que es zona segura.
- **Vuelo:** la barra de energía se gasta al aletear y se recarga en el suelo. En el aire, moverte hacia adelante planea (caes más despacio y vas más rápido). Desde arriba no te alcanzan, pero la energía se acaba.
- **Huevos:** hasta 6; pones uno nuevo cada 7 s. Un huevazo aturde a Don Ramiro un instante, hace huir a Doña Chona, tira cubetas y golpea al espantapájaros.
- **Popó:** hasta 5 cargas; se recargan comiendo **maíz** o con el tiempo. Sale hacia atrás: date la vuelta o tírala desde arriba. En el sombrero vale doble.
- **Picotazo:** cubetas, cerdo, vaca, espantapájaros (5 golpes), gallinas (se reclutan) y humanos.
- **Niveles:** 3 misiones por nivel. Al cumplirlas ganas puntos y una vida; Don Ramiro corre más y Doña Chona entra en escena. Del nivel 5 en adelante las misiones se generan al azar.
- El récord se guarda en el visor o navegador.

## El mundo

Patio de 68 × 68 m con granero y silo, gallinero, corral del cerdo, pradera de la vaca, huerto de manzanos, hortaliza, estanque, pozo, tractor, molino con aspas giratorias y plataforma, pacas de heno, árboles y maizales exteriores. Texturas procedurales, sombras dinámicas, cielo con gradiente y reflejos de entorno; en el visor las sombras bajan de resolución para mantener la fluidez.

## Vista previa en una computadora

```bash
python3 -m http.server 8080
```

Abre `http://localhost:8080/` y haz clic en **Jugar en esta pantalla** (el juego captura el mouse; `Esc` pausa).

**Importante:** abrir `index.html` por `file://` o visitar por IP local con HTTP no permite iniciar una sesión WebXR inmersiva en Quest: usa HTTPS. El dispositivo necesita Internet para cargar Three.js desde el CDN indicado en `index.html`.

## Archivos

- `index.html` — shell, estilos, importmap de Three.js r180.
- `main.js` — texturas procedurales, granja, personajes, física (correr, volar, planear, colisiones), IA, proyectiles, misiones y niveles, HUD de escritorio y de VR, vistas.
- `icon.svg` — favicon.

Sin dependencias de compilación ni assets externos.
