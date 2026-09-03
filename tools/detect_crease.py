import bpy, sys, math, json, numpy as np
bpy.ops.wm.read_factory_settings(use_empty=True)
src=sys.argv[-1]; out='/'.join(src.split('/')[:-1])
bpy.ops.import_scene.gltf(filepath=src)
for o in bpy.data.objects:
    if o.type=='MESH' and o.name!='Body_Mosshopper': o.hide_render=True
sc=bpy.context.scene; sc.render.engine='BLENDER_WORKBENCH'; sc.display.shading.light='FLAT'; sc.display.shading.color_type='TEXTURE'
sc.render.resolution_x=2048; sc.render.resolution_y=2048; sc.render.film_transparent=True
cam=bpy.data.cameras.new('c'); co=bpy.data.objects.new('c',cam); sc.collection.objects.link(co); sc.camera=co
cam.type='ORTHO'; S=0.4; CZ=0.66; cam.ortho_scale=S
co.location=(0,-3,CZ); co.rotation_euler=(math.radians(90),0,0)
sc.render.filepath=out+'/crease_front.png'; bpy.ops.render.render(write_still=True)
img=bpy.data.images.load(out+'/crease_front.png'); W,H=img.size
px=np.array(img.pixels[:]).reshape(H,W,4)  # row 0 = bottom
def z_of_row(r): return CZ+(r-H/2)*(S/H)
def x_of_col(c): return (c-W/2)*(S/W)
res={}
for c in range(0,W,16):
    x=x_of_col(c)
    if abs(x)>0.19: continue
    col=px[:,c,:]
    # scan rows within z 0.60..0.74 ; yellowness = R+G high, B low ; green = G>R clearly
    best=None
    for r in range(int((0.60-CZ)/(S/H)+H/2), int((0.74-CZ)/(S/H)+H/2)):
        R,G,B,A=col[r]
        if A<0.5: continue
        # crease = transition from yellow (below) to green (above): find topmost yellow row
        if R>0.35 and R/(G+1e-6)>0.85: best=r
    if best is not None: res[round(x,3)]=round(z_of_row(best),4)
json.dump(res,open(out+'/crease.json','w'),indent=0)
print('CREASE',len(res),'cols; center z=',res.get(0.0) or res.get(min(res,key=lambda k:abs(k))),'min',min(res.values()),'max',max(res.values()))
# overlay
for xk,zk in res.items():
    c=int(xk/(S/W)+W/2); r=int((zk-CZ)/(S/H)+H/2)
    px[max(0,r-2):r+3,max(0,c-2):c+3,:]=[1,0,1,1]
img.pixels=px.flatten().tolist(); img.filepath_raw=out+'/crease_overlay.png'; img.file_format='PNG'; img.save()
