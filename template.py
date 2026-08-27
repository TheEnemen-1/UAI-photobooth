from PIL import Image, ImageDraw

def generate_frame_template():
    # 1. Setup dimensions
    width, height = 600, 1800
    background_color = (200, 200, 200) # Grey background to see margins
    
    # Create canvas
    img = Image.new('RGB', (width, height), background_color)
    draw = ImageDraw.Draw(img)
    
    # 2. Define specifications
    img_w, img_h = 540, 304
    padding_x = 30
    start_y = 80
    gap = 80
    
    # 3. Draw 4 photo boxes
    for i in range(4):
        x0 = padding_x
        y0 = start_y + i * (img_h + gap)
        x1 = x0 + img_w
        y1 = y0 + img_h
        
        # Draw white box (where the photo will be)
        draw.rectangle([x0, y0, x1, y1], fill=(255, 255, 255), outline=(0, 0, 0))
        
        # Add text label
        draw.text((x0 + 10, y0 + 10), f"Photo {i+1} (540x304)", fill=(0, 0, 0))

    # 4. Highlight Footer area
    footer_y_start = start_y + 3 * (img_h + gap) + img_h
    draw.rectangle([0, footer_y_start, width, height], fill=(150, 150, 150))
    draw.text((width//2 - 50, footer_y_start + 150), "FOOTER AREA\n(Logos & Hashtags)", fill=(255, 255, 255))

    # Save the result
    img.save("frame_template.png")
    print("Template created: frame_template.png")

if __name__ == "__main__":
    generate_frame_template()