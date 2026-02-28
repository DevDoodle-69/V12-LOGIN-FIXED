# Flux AI Pro Bot

Text-to-Image generation command implementation based on `nbpro.js` patterns.

## Commands

### t2i
Generates images from text prompts.

**Usage:**
`t2i <prompt> --ar <ratio> --provider <provider> --model <model> --num <1-4>`

**Parameters:**
- `prompt`: Description of the image.
- `--ar`: Aspect ratio (1:1, 4:5, 9:16, 16:9, 21:9, 2k, 4k).
- `--provider`: API provider (koy, infip, aqua, kinai, airforce, kaai).
- `--model`: Model ID (flux-2-dev, nanobanana, klein-large, flux-schnell, imagen-4).
- `--num`: Number of images to generate (1 to 4).

**Example:**
`t2i futuristic city --ar 16:9 --provider koy --model flux-2-dev --num 2`
