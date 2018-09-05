const { declare } = require('@babel/helper-plugin-utils');
const { types } = require('@babel/core');
const os = require('os');

/**
 * @param {types} t
 */
function utils(t) {
	const fns = {
		/**
		 *
		 * @param {string} key
		 * @param {string} value
		 */
		generateLiteralPropery(key, value) {
			return t.objectProperty(t.identifier(key), t[typeof value + 'Literal'](value));
		},

		/**
		 *
		 * @param {string} key
		 * @param {*} valueExpression
		 */
		generateProperty(key, valueExpression) {
			return t.objectProperty(
				t.identifier(key),
				valueExpression,
			)
		},

		generateObject(required, properties) {
			return t.objectExpression([
				fns.generateLiteralPropery('type', 'object'),
				fns.generateProperty('required', required),
				fns.generateProperty('properties', t.objectExpression(properties)),
			])
		},


		generateRequired(requires = []) {
			return t.arrayExpression(
				requires.map(required => t.stringLiteral(required))
			)
		},

		handleComment(node) {
			let extraProps
			if (node.leadingComments && node.leadingComments.length > 0) {
				const comment = node.leadingComments[0].value;
				comment.split(os.EOL)
					.map(line => line.replace(/\s*\**\s*/, ''))
					.filter(f => f)
					.forEach(line => {
						const [key, value] = line.split(':');
						extraProps = {
							key: key.trim(),
							value: JSON.parse(value.trim())
						}
					});
			}
			return extraProps;
		},

		getPropType(node) {
			let propType;
			let required = false;
			let returnNode = node;
			// 如果是非方法(string/number..., 或者是isRequired)
			if (t.isMemberExpression(node)) {
				if (node.property.name === 'isRequired') {
					// 如果是函数,取函数名(shape等)
					if (t.isCallExpression(node.object)) {
						propType = node.object.callee.property.name;
					} else {
						propType = node.object.property.name;
					}
					required = true;
					returnNode = node.object;
				} else {
					propType = node.property.name;
				}
			}
			// 是方法(shape..)
			if (t.isCallExpression(node)) {
				propType = node.callee.property.name;
			}

			return {
				propType,
				required,
				returnNode,
			};
		},


		handleProperty(node) {
			const extraProps = this.handleComment(node);
			const { propType, required, returnNode } = this.getPropType(node.value);
			if (typeof this[propType] === 'function') {
				return {
					property: this[propType](extraProps, returnNode),
					required,
				};
			}
			return {};
		},

		handleProperties(propertyExps) {
			const properties = [];
			const requires = [];
			propertyExps.forEach((node) => {
				const propKey = node.key.name;
				const { property, required } = this.handleProperty(node);
				if (property) {
					properties.push(t.objectProperty(t.identifier(propKey), property));
				}
				if (required) {
					requires.push(propKey);
				}
			});
			return this.generateObject(this.generateRequired(requires), properties);
		}
	};

	const propTypes = {
		string(extraProps) {
			const properties = [fns.generateLiteralPropery('type', 'string')];
			if (extraProps) {
				properties.push(fns.generateLiteralPropery(extraProps.key, extraProps.value))
			}
			return t.objectExpression(properties);
		},
		number(extraProps) {
			const properties = [fns.generateLiteralPropery('type', 'number')];
			if (extraProps) {
				properties.push(fns.generateLiteralPropery(extraProps.key, extraProps.value))
			}
			return t.objectExpression(properties);
		},
		bool(extraProps) {
			const properties = [fns.generateLiteralPropery('type', 'boolean')];
			if (extraProps) {
				properties.push(fns.generateLiteralPropery(extraProps.key, extraProps.value))
			}
			return t.objectExpression(properties);
		},
		shape(extraProps, node) {
			const objectExp = this.handleProperties(node.arguments[0].properties);
			const properties = objectExp.properties;
			if (extraProps) {
				properties.push(fns.generateLiteralPropery(extraProps.key, extraProps.value))
			}
			return objectExp;
		},
		arrayOf(extraProps, node) {
			const properties = [fns.generateLiteralPropery('type', 'array')];
			if (extraProps) {
				properties.push(fns.generateLiteralPropery(extraProps.key, extraProps.value))
			}
			if (t.isMemberExpression(node.arguments[0])) {
				properties.push(fns.generateProperty('items', t.objectExpression([fns.generateLiteralPropery('type', node.arguments[0].property.name)])))
			}
			if (t.isCallExpression(node.arguments[0])) {
				properties.push(fns.generateProperty('items', this.shape(extraProps, node.arguments[0])));
			}
			return t.objectExpression(properties);
		},
		oneOf(extraProps, node) {
			const properties = [fns.generateLiteralPropery('type', 'array')];
			if (extraProps) {
				properties.push(fns.generateLiteralPropery(extraProps.key, extraProps.value))
			}
			// 默认用第一个作为类型
			let valueType = typeof node.arguments[0].elements[0].value; //TODO: elements有可能没有
			properties.push(fns.generateProperty('items', t.objectExpression([
				fns.generateLiteralPropery('type', valueType),
				fns.generateProperty('enum', node.arguments[0].__clone()),
			])));
			return t.objectExpression(properties);
		}
	};

	Object.assign(fns, propTypes);
	return fns;
}
module.exports = declare(api => {
	api.assertVersion(7);
	/** @type {types} */
	const t = api.types;
	const state = {
		start: false,
		componentName: '',
		schema: null,
		__proto__: {
			clear() {
				this.start = false;
				this.componentName = '';
				this.schema = null;
			}
		}
	};
	const fns = utils(t);
	return {
		visitor: {
			MemberExpression(path) {
				if (!state.start) return;
				const { node, parent } = path;
				const { right } = parent;
				if (!t.isObjectExpression(right)) return;
				if (t.isIdentifier(node.property, {
					name: 'propTypes'
				})) {
					state.schema = fns.handleProperties(right.properties);
				}

			},
			ExpressionStatement: {
				enter(path) {
					const { node } = path;
					if (node.leadingComments &&
						node.leadingComments.length > 0 &&
						node.leadingComments[0].value.indexOf('@schema') !== -1
					) {
						state.start = true;
						t.assertAssignmentExpression(node.expression, { operator: '=' });
						state.componentName = node.expression.left.object.name;
					}
				},
				exit(path) {
					if (state.schema) {
						path.insertAfter(t.expressionStatement(
							t.assignmentExpression(
								'=',
								t.memberExpression(
									t.identifier(state.componentName),
									t.identifier('schema')
								),
								state.schema
							)
						))
					}
					state.clear();
				}
			}
		}
	}
})