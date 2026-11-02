"""标准件参数数据库
螺纹基本牙型: ISO 68 / GB/T 192 (米制60°螺纹)
六角头螺栓:   GB/T 5782 (等效 ISO 4014)
六角螺母:     GB/T 6170 (等效 ISO 4032)
通孔直径:     GB/T 5277 (中等装配系列)
单位: mm
"""
H_COEF = 0.8660254
DEDUCT_COEF = 1.082532
THREAD_DEPTH_COEF = 0.541266
BOLT_TABLE = {'M6': (1.0, 10.0, 4.0, 5.2, 6.4), 'M8': (1.25, 13.0, 5.3, 6.8, 8.4), 'M10': (1.5, 16.0, 6.4, 8.4, 10.5), 'M12': (1.75, 18.0, 7.5, 10.8, 13.0), 'M14': (2.0, 21.0, 8.8, 12.8, 15.0), 'M16': (2.0, 24.0, 10.0, 14.8, 17.0), 'M18': (2.5, 27.0, 11.5, 15.8, 19.0), 'M20': (2.5, 30.0, 12.5, 18.0, 21.0), 'M22': (2.5, 34.0, 14.0, 19.4, 23.0), 'M24': (3.0, 36.0, 15.0, 21.5, 25.0), 'M27': (3.0, 41.0, 17.0, 23.8, 28.0), 'M30': (3.5, 46.0, 18.7, 25.6, 31.0), 'M33': (3.5, 50.0, 21.0, 28.7, 34.0), 'M36': (4.0, 55.0, 22.5, 31.0, 37.0)}
FINE_PITCH = {'M8': [1.0], 'M10': [1.25, 1.0], 'M12': [1.5, 1.25], 'M14': [1.5], 'M16': [1.5], 'M18': [1.5], 'M20': [2.0, 1.5], 'M22': [1.5], 'M24': [2.0], 'M27': [2.0], 'M30': [2.0], 'M33': [2.0], 'M36': [3.0]}
SIZES = list(BOLT_TABLE.keys())
ROUND_HEAD_TABLE = {'M6': (10.5, 3.3), 'M8': (14.0, 4.4), 'M10': (17.5, 5.5), 'M12': (21.0, 6.6), 'M16': (28.0, 8.8)}

def round_head_dk(size_name):
    d = nominal_diameter(size_name)
    return ROUND_HEAD_TABLE.get(size_name, (1.75 * d, 0.55 * d))[0]

def round_head_k(size_name):
    d = nominal_diameter(size_name)
    return ROUND_HEAD_TABLE.get(size_name, (1.75 * d, 0.55 * d))[1]
CYL_HEAD_TABLE = {'M6': (10.0, 6.0), 'M8': (13.0, 8.0), 'M10': (16.0, 10.0), 'M12': (18.0, 12.0), 'M14': (21.0, 14.0), 'M16': (24.0, 16.0), 'M18': (27.0, 18.0), 'M20': (30.0, 20.0), 'M22': (33.0, 22.0), 'M24': (36.0, 24.0), 'M27': (40.0, 27.0), 'M30': (45.0, 30.0), 'M33': (50.0, 33.0), 'M36': (54.0, 36.0)}

def cyl_head_dk(size_name):
    d = nominal_diameter(size_name)
    return CYL_HEAD_TABLE.get(size_name, (1.5 * d, d))[0]

def cyl_head_k(size_name):
    d = nominal_diameter(size_name)
    return CYL_HEAD_TABLE.get(size_name, (1.5 * d, d))[1]

def nominal_diameter(size_name):
    return float(size_name[1:])

def coarse_pitch(size_name):
    return BOLT_TABLE[size_name][0]

def head_flats(size_name):
    return BOLT_TABLE[size_name][1]

def head_height(size_name):
    return BOLT_TABLE[size_name][2]

def nut_height(size_name):
    return BOLT_TABLE[size_name][3]

def clearance_hole(size_name):
    return BOLT_TABLE[size_name][4]

def default_thread_length(d, L):
    if L <= 125:
        return min(L, 2 * d + 6)
    elif L <= 200:
        return min(L, 2 * d + 12)
    return min(L, 2 * d + 25)
