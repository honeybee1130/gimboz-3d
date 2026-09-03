import bpy, sys, math
bpy.ops.wm.read_factory_settings(use_empty=True)
src=sys.argv[-1]; outdir='/'.join(src.split('/')[:-1])
bpy.ops.import_scene.gltf(filepath=src)
sc=bpy.context.scene; sc.render.engine='BLENDER_WORKBENCH'; sc.display.shading.light='STUDIO'; sc.display.shading.color_type='TEXTURE'
sc.render.resolution_x=512; sc.render.resolution_y=512; sc.render.film_transparent=False
cam=bpy.data.cameras.new('c'); co=bpy.data.objects.new('c',cam); sc.collection.objects.link(co); sc.camera=co
cam.type='ORTHO'; cam.ortho_scale=0.5
meshes=[o for o in bpy.data.objects if o.type=='MESH' and o.data.shape_keys]
keys=[k.name for k in meshes[0].data.shape_keys.key_blocks if k.name!='Basis']
def setkey(name,val):
    for o in meshes:
        for k in o.data.shape_keys.key_blocks:
            k.value = val if k.name==name else 0.0
def shot(fn,loc,rot):
    co.location=loc; co.rotation_euler=rot; sc.render.filepath=fn; bpy.ops.render.render(write_still=True)
for k in ['Basis']+keys:
    setkey(k,1.0)
    shot(f'{outdir}/qc_{k}_front.png',(0,-3,0.66),(math.radians(90),0,0))
    shot(f'{outdir}/qc_{k}_34.png',(-2.2,-2.2,0.66),(math.radians(90),0,math.radians(-45)))
setkey('Basis',0)
# eye bone gaze test: rotate eye bones
arm=bpy.data.objects['Armature']
for n,ang in (('eye_l',25),('eye_r',25)):
    pb=arm.pose.bones[n]; pb.rotation_mode='XYZ'; pb.rotation_euler=(0,0,math.radians(ang))
shot(f'{outdir}/qc_gaze_front.png',(0,-3,0.66),(math.radians(90),0,0))
print('QC_DONE',keys)
