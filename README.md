# Gallina Prófuga VR — Meta Quest 3 y Meta Quest 3S

Eres una gallina en una granja y Don Ramiro, el granjero, quiere degollarte. Un simulador de caos al estilo *I Am Cat*: cumples misiones de gallina (hacerle popó a la gente, tirar cubetas, picotear al cerdo, derribar al espantapájaros, subirte al techo del gallinero…), subes de nivel y la dificultad crece. Funciona en **Meta Quest Browser (WebXR)** y en computadora con teclado y mouse.

## Cómo jugar en el Meta Quest 3 / 3S

1. En el visor, abre **Meta Quest Browser** y entra a la URL HTTPS publicada (GitHub Pages).
2. Pulsa **ENTER VR** y acepta la solicitud de acceso a VR.
3. Aprieta el **gatillo** para empezar.

| Acción | Meta Quest | Computadora |
|---|---|---|
| Moverte | Stick izquierdo | `W A S D` / flechas |
| Girar / mirar | Stick derecho (giro de 30°) | Mouse |
| Aletear (hasta 3 seguidos) | `A` / `X` | `Espacio` |
| Popó (sale por atrás) | Gatillo | Clic izquierdo / `Q` |
| Picotazo | Agarre (grip) | Clic derecho / `E` |

En VR te encoges al tamaño de una gallina: el granjero mide "siete metros". En computadora la cámara va a 40 cm del suelo.

## Reglas

- **Vidas:** 3. Si Don Ramiro te alcanza, pierdes una y reapareces en el **gallinero**, que es zona segura (él no entra; ronda la puerta y se aburre).
- **Popó:** tienes hasta 5 cargas. Se recargan comiendo **maíz** o lentamente con el tiempo. La popó sale **hacia atrás**: date la vuelta cerca de tu víctima o tírala desde una paca o un techo. Si le cae en el sombrero vale el doble.
- **Aletear:** tres aleteos seguidos te suben a pacas, al tractor o al techo del gallinero (desde ahí el granjero no te alcanza).
- **Picotazo:** tira cubetas, enfurece al cerdo, derriba al espantapájaros (5 picotazos), recluta gallinas y enoja a los humanos.
- **Niveles:** cada nivel tiene 3 misiones. Al cumplirlas ganas puntos, una vida extra y pasas al siguiente; Don Ramiro corre más rápido y Doña Chona entra en escena. A partir del nivel 4 las misiones se generan al azar con metas cada vez más altas.
- El récord (nivel y puntos) se guarda en el visor o navegador.

## Vista previa en una computadora

```bash
python3 -m http.server 8080
```

Abre `http://localhost:8080/` y haz clic en **Jugar en esta pantalla** (el juego captura el mouse; `Esc` pausa).

**Importante:** abrir `index.html` por `file://` o visitar por IP local con HTTP no permite iniciar una sesión WebXR inmersiva en Quest: usa HTTPS. El dispositivo necesita Internet para cargar Three.js desde el CDN indicado en `index.html`.

## Archivos

- `index.html` — shell, estilos, importmap de Three.js r180.
- `main.js` — granja, personajes, física, IA del granjero, misiones y niveles, HUD de escritorio y de VR.
- `icon.svg` — favicon.

Sin dependencias de compilación ni assets externos: todo es geometría y audio generados en código.
